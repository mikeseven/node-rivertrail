﻿/*
 * Copyright (c) 2011, Intel Corporation
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without 
 * modification, are permitted provided that the following conditions are met:
 *
 * - Redistributions of source code must retain the above copyright notice, 
 *   this list of conditions and the following disclaimer.
 * - Redistributions in binary form must reproduce the above copyright notice, 
 *   this list of conditions and the following disclaimer in the documentation 
 *   and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE 
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR 
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF 
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS 
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) 
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF 
 * THE POSSIBILITY OF SUCH DAMAGE.
 *
 */


if (RiverTrail === undefined) {
  var RiverTrail = (typeof window === 'undefined') ? global.RiverTrail : {};
}

// Executes the kernel function with the ParallelArray this and the args for the elemental function
// paSource     - 'this' inside the kernel
// kernelString - either a JavaScript code string or a precompiled kernel (dpoIKernel object)
// ast          - result from parsing
// f            - function to compile
// construct    - outer construct in {combine,,map,comprehension,comprehensionScalar}
// rankOrShape  - either the rank of the iteration space, or for comprehension the shape of the interationspace
// actualArgs   - extra kernel arguments

RiverTrail.compiler.runOCL = function () {

    // Executes the kernel function with the ParallelArray this and the args for the elemental function
    // paSource     - 'this' inside the kernel
    // kernelString - either a JavaScript code string or a precompiled kernel (dpoIKernel object)
    // ast          - result from parsing
    // f            - function to compile
    // construct    - outer construct in {combine,map,comprehension,comprehensionScalar}
    // rankOrShape  - either the rank of the iteration space, or for comprehension the shape of the interationspace
    // actualArgs   - extra kernel arguments
    var runOCL = function runOCL(paSource, kernelString, ast, f, construct, rankOrShape, actualArgs,
                                 argumentTypes, lowPrecision, enable64BitFloatingPoint, useBufferCaching, useKernelCaching) {
        var paResult;
        var kernelArgs = [];
        var resultMemObj;
        var resultOffset;
        var sourceType;
        var iterSpace;
        var resultElemType;
        var kernel;
        var rank;
        var resShape;
        var resSize;
        var kernelName = ast.name;
        if (!kernelName) {
            throw new Error("Invalid ast: Function expected at top level");
        }
        if ((construct === "comprehension") || (construct === "comprehensionScalar")) {
            // comprehensions do not have a source, so we derive the required information
            // from rank and the ast
            sourceType = undefined;
            iterSpace = rankOrShape;
            rank = iterSpace.length;
        } else {
            sourceType = RiverTrail.Helper.inferPAType(paSource);
            rank = rankOrShape;
            iterSpace = sourceType.dimSize.slice(0, rank);
        }
        resultElemType = RiverTrail.Helper.stripToBaseType(ast.typeInfo.result.OpenCLType);

        if (ast.typeInfo.result.properties) {
            resShape = iterSpace.concat(ast.typeInfo.result.getOpenCLShape());
        } else {
            resShape = iterSpace;
        }
        resSize = shapeToLength(resShape);
        // construct kernel arguments
        var jsObjectToKernelArg = function (args, object) {
            if (object instanceof ParallelArray) {
                if (object.data instanceof Components.interfaces.dpoIData) {
                    // we already have an OpenCL value
                    args.push(object.data);
                } else if (RiverTrail.Helper.isTypedArray(object.data)) {
                    if ((object.cachedOpenCLMem === undefined)) {
                        // we map this argument
                        object.cachedOpenCLMem = RiverTrail.compiler.openCLContext.mapData(object.data);
                    }
                    args.push(object.cachedOpenCLMem);
                    if (!useBufferCaching) {
                        object.cachedOpenCLMem = undefined;
                    }
                } else {
                    // We have a regular array as data container. There is no point trying
                    // to convert it, as the constructor would already have tried.
                    throw new Error("Cannot transform regular array to OpenCL kernel arguments");
                }
                // Add the offset as an additional integer argument. Use the Integer Object here.
                args.push(new RiverTrail.Helper.Integer(object.offset));
            } else if (object instanceof RiverTrail.Helper.FlatArray) {
                // these are based on a flat array, so we can just push the data over
                args.push(RiverTrail.compiler.openCLContext.mapData(object.data));
            } else if (typeof (object) === "number") {
                // Scalar numbers are passed directly, as doubles.
                args.push(object);
            } else if (object instanceof Number) {
                // Numbers are passed as just their values
                args.push(object.valueOf());
            } else if (object instanceof RiverTrail.Helper.Integer) {
                // How did I get here.
                console.log("(object instanceof RiverTrail.Helper.Integer) encountered unexpectedly");
                // Integers are passed directly
                args.push(object);
            } else if (RiverTrail.Helper.isTypedArray(object)) {
                // map the typed array
                args.push(RiverTrail.compiler.openCLContext.mapData(object));
            } else {
                throw new Error("only typed arrays and scalars are currently supported as OpenCL kernel arguments");
            }
            return args;
        }
        if ((construct !== "comprehension") && (construct !== "comprehensionScalar")) {
            jsObjectToKernelArg(kernelArgs, paSource);
            // console.log("jsObjectToKernelArg:kernelArgs.length: "+kernelArgs.length);
        }
        if (actualArgs !== undefined) {
            Array.prototype.reduce.call(actualArgs, jsObjectToKernelArg, kernelArgs);
        }
        // add memory for result
        // SAH: We have agreed that operations are elemental type preserving, thus I reuse the type
        //      of the argument here.
        if (paSource.updateInPlacePA !== undefined) {
            // the result space has been preallocated for us! So just use/map what is there.
            // See scan for how this is supposed to work
            // first we ensure that the shape of what we compute is the shape of what is expected
            if (!equalsShape(resShape, paSource.updateInPlaceShape)) {
                // throwing this will revert the outer scan to non-destructive mode
                throw new Error("shape mismatch during update in place!");
            }
            if (++paSource.updateInPlaceUses !== 1) {
                throw new Error("preallocated memory used more than once!");
            }
            if (!(paSource.updateInPlacePA.data instanceof Components.interfaces.dpoIData)) {
                paSource.updateInPlacePA.data = RiverTrail.compiler.openCLContext.mapData(paSource.updateInPlacePA.data);
            }
            resultMemObj = paSource.updateInPlacePA.data;
            resultOffset = paSource.updateInPlaceOffset;
        } else {
            // We allocate whatever the result type says. To ensure portability of 
            // the extension, we need a template typed array. So lets just create one!
            var template = RiverTrail.Helper.elementalTypeToConstructor(resultElemType);
            if (template == undefined) throw new Error("cannot map inferred type to constructor");
            resultMemObj = RiverTrail.compiler.openCLContext.allocateData(new template(1), resSize);
            resultOffset = 0;
        }
        kernelArgs.push(resultMemObj);
        kernelArgs.push(new RiverTrail.Helper.Integer(resultOffset));
        // build kernel
        if (kernelString instanceof Components.interfaces.dpoIKernel) {
            kernel = kernelString;
        } else {
            try {
                if (enable64BitFloatingPoint) {
                    // enable 64 bit extensions
                    kernelString = "#pragma OPENCL EXTENSION cl_khr_fp64 : enable\n" + kernelString;
                }
                kernel = RiverTrail.compiler.openCLContext.compileKernel(kernelString, kernelName);
            } catch (e) {
                try {
                    RiverTrail.Helper.debugThrow(e + RiverTrail.compiler.openCLContext.buildLog);
                } catch (e2) {
                    RiverTrail.Helper.debugThrow(e + e2);
                }
            }
            try {
                if (useKernelCaching && (f !== undefined)) {
                    // save ast information required for future use
                    var cacheEntry = { "ast": ast,
                        "name": ast.name,
                        "source": f,
                        "paType": sourceType,
                        "kernel": kernel,
                        "construct": construct,
                        "lowPrecision": lowPrecision,
                        "argumentTypes": argumentTypes,
                        "iterSpace": iterSpace
                    };
                    f.openCLCache.push(cacheEntry);
                }
            } catch (e) {
                try {
                    RiverTrail.Helper.debugThrow(e + RiverTrail.compiler.openCLContext.buildLog);
                } catch (e2) {
                    RiverTrail.Helper.debugThrow(e + e2);
                }
            }
        }
        // set arguments
        kernelArgs.reduce(function (kernel, arg, index) {
            try {
                //console.log("driver 344 index: ", index, " arg: ", arg);
                if (typeof (arg) === "number") {
                    kernel.setScalarArgument(index, arg, false, !lowPrecision);
                } else if (arg instanceof RiverTrail.Helper.Integer) {
                    // console.log("index: ", index, " arg.value: ", arg.value);
                    kernel.setScalarArgument(index, arg.value, true, false);
                    // console.log("good");
                } else if (arg instanceof Components.interfaces.dpoIData) {
                    kernel.setArgument(index, arg);
                } else {
                    throw new Error("unexpected kernel argument type!");
                }
                return kernel;
            } catch (e) {
                console.log("reduce error: ", e, " index: ", index, "arg: ", arg);
                throw e;
            }
        }, kernel);

        if ((construct === "map") || (construct == "combine") || (construct == "comprehension") || (construct == "comprehensionScalar")) {
            // The differences are to do with args to the elemental function and are dealt with there so we can use the same routine.
            // kernel.run(rank, shape, tiles)
            try {
                // console.log("791:new:rank: "+rank+" iterSpace: "+iterSpace);
                //console.log("driver:389 did not run.");
                var kernelFailure = kernel.run(rank, iterSpace, iterSpace.map(function () { return 1; }));
            } catch (e) {
                console.log("kernel.run fails: ", e);
                throw e;
            }
            if (kernelFailure) {
                // a more helpful error message would be nice. However, we don't know why it failed. A better exception model is asked for...
                throw new Error("kernel execution failed, probably due to an array out of bounds access.");
            }
        } else {
            alert("runOCL only deals with comprehensions, map and combine (so far).");
        }
        paResult = new ParallelArray(resultMemObj, resShape, resultElemType);
        return paResult;
    };

    // Finally a bunch of helper functions that know how to walk the ast.
    
    // Given the shape of an array return the number of elements. Duplicate from ParallelArray.js 
    var shapeToLength = function shapeToLength(shape) {
        var i;
        var result;
        if (shape.length == 0) {
            return 0;
        }
        result = shape[0];
        for (i = 1; i < shape.length; i++) {
            result = result * shape[i];
        }
        return result;
    };

    return runOCL;
} ();
