/*
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

// Copyright (c) 2011-2012, Motorola Mobility, Inc.
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//  * Redistributions of source code must retain the above copyright
//    notice, this list of conditions and the following disclaimer.
//  * Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
//  * Neither the name of the Motorola Mobility, Inc. nor the names of its
//    contributors may be used to endorse or promote products derived from this
//    software without specific prior written permission.
//
//  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
// DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
// THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

var nodejs = (typeof window === 'undefined');
if(nodejs) {
  require(__dirname+'/../../jslib');

  var document = require('node-webgl').document(),
      Image = require('node-image').Image;
}

var log=console.log;

// output image
var width = 800, height = 800, sz = width*height;

// convergence parameters
var limit = 4, nmax = 512;

// the below code is based on a WebCL implementation available at
// http://www.ibiblio.org/e-notes/webcl/mandelbrot.html

// palette parameters
var nc = 30, maxCol = nc*3, cr,cg,cb;

// initialises the color map for translating Mandelbrot iterations
// into nice colors
function computeColorMap() {
   var st = 255/nc;
   cr = new Array(maxCol); cg = new Array(maxCol); cb = new Array(maxCol);
   for (var i = 0; i < nc; i++){
     var d = Math.floor(st*i);
     cr[i] = 255 - d;  cr[i+nc] = 0;  cr[i+2*nc] = d;
     cg[i] = d;  cg[i+nc] = 255 - d;  cg[i+2*nc] = 0;
     cb[i] = 0;  cb[i+nc] = d;  cb[i+2*nc] = 255 - d;
   }
   cr[maxCol] = cg[maxCol] = cb[maxCol] = 0;
}

// this is the actual mandelbrot computation, ported to JavaScript
// from the WebCL / OpenCL example at 
// http://www.ibiblio.org/e-notes/webcl/mandelbrot.html

// z_n = z_{n-1}^2+c with z_0 = 0
// n is the number of iterations and color at c(x,y)
// test for divergence: radius>=2 or max iterations (512) reached
function computeSet(iv, scale, limit, nmax, width, height) {
  var y = iv[1];
  var x = iv[0];

  var x2 = x-width*0.5, y2 = y-height*0.5;  // center image
  var Cr = x2 / scale + 0.407476;
  var Ci = y2 / scale + 0.234204;
  var I = 0, R = 0, I2 = 0, R2 = 0;
  var n = 0;

  while ((R2 + I2 < limit) && (n < nmax)) {
    I = (R + R) * I + Ci;   // imaginary part
    R = R2 - I2 + Cr;       // real part
    R2 = R * R;
    I2 = I * I;
    //n++;  // [mbs] this produces ((int)n)++; 'error: assignment to cast is illegal, lvalue casts are not supported'
    n=n+1;
  }
  return n; // number of iterations at (x,y)
}

// helper function to write the result of computing the mandelbrot
// set to a canvas
function writeResult (canvas, mandelbrot) {
  var pix;
  if(!nodejs) {
    var context = canvas.getContext("2d");
    var image = context.createImageData(width, height);
    pix = image.data;
  }
  else {
    pix = new Uint8Array(sz * 4);
  }

  var mbrot = mandelbrot.flatten();
  var outBuffer = mbrot.getArray();
  for (var t = 0, c= 0, ic; t < sz; t++) {
    var i = outBuffer[t];
    if (i == nmax) ic = maxCol;
    else ic = i % maxCol;
    pix[c++] = cr[ic];
    pix[c++] = cg[ic];
    pix[c++] = cb[ic];
    pix[c++] = 255;
  }

  if(!nodejs)
    context.putImageData(image, 0, 0);
  else {
    var filename=__dirname+'/mandelbrot.png';
    log('writing image: '+filename);
    if(!Image.save(filename, pix, width, height, width*4))
      log("Error saving image");
  }
}

function render () {
  var canvas = document.getElementById("canvas");
  var scale = 10000*300;
  computeColorMap();
  try {
    var mandelbrot = new ParallelArray([width,height], computeSet, scale, limit, nmax, width, height);
    writeResult(canvas, mandelbrot);
  } catch(err) {
    log(err);
  }
}

if(nodejs) {
  render();
}
