var cl=require('node-webcl');
var util=require('util');
var log=console.log, exit=process.exit;


//// Interfaces
function dpoIInterface() {}
dpoIInterface.prototype={
  getPlatform:function() {},
  version:0
}

function dpoIPlatform() {
  // Methods to query properties of a platform
  this.numberOfDevices;
  this.version;
  this.name;
  this.vendor;
  this.profile;
  this.extensions;
}
dpoIPlatform.prototype.createContext = function() {}

function dpoIKernel() {
  this.numberOfArgs;
}
dpoIKernel.prototype={
  // Methods to supply arguments to a kernel.
  setArgument:function(number, argument) {},
  setScalarArgument:function(number, argument, isInteger, highPrecision) {},

  // Methods to run a kernel
  run:function(rank, shape, tile) {}
}

function dpoIData() {}
dpoIData.prototype.getValue=function(){}
dpoIData.prototype.writeTo=function(dest) {}

function dpoIContext() {}
dpoIContext.prototype= {
  compileKernel : function(source, kernelName, options) {},
  buildLog: '',
  mapData: function(source) { log('\nERROR mapData not implemented\n'); },
  cloneData: function(source) { log('\nERROR cloneData not implemented\n'); },
  allocateData: function(templ, length) { log('\nERROR allocateData not implemented\n'); },
  allocateData2: function(templ, length) { log('\nERROR allocateData2 not implemented\n'); },
  lastExecutionTime: 0,
  lastRoundTripTime: 0
};

var Components=(function () {
  var my={};
  my.interfaces={
    "dpoIInterface" : dpoIInterface,
    "dpoIPlatform" : dpoIPlatform,
    "dpoIKernel" : dpoIKernel,
    'dpoIData' : dpoIData,
    'dpoIContext' : dpoIContext
  };
  return my;
}());

exports.Components=Components;

/////////// classes

function DPOInterface() {
  this.version=2;
}
util.inherits(DPOInterface, dpoIInterface);
exports.DPOInterface=DPOInterface;

DPOInterface.prototype.getPlatform=function() {
  //Pick platform
  var platformList=cl.getPlatforms();
  platform=platformList[0];
  //log('using platform: '+platform.getInfo(cl.PLATFORM_NAME));
  return new DPOPlatform(platform);
}
DPOInterface.prototype.version=2;

function DPOPlatform(pf) {
  this.platform=pf;
  this.context;
}
util.inherits(DPOPlatform, dpoIPlatform);
DPOPlatform.prototype.createContext = function() {
  this.context=new DPOContext();
  this.context.init(this);
  return this.context;
}

DPOPlatform.prototype.__defineGetter__("numberOfDevices", function() { return platform.getDevices(cl.DEVICE_TYPE_ALL).length; });
DPOPlatform.prototype.__defineGetter__("version", function() { return "2"; });
DPOPlatform.prototype.__defineGetter__("name", function() { return platform.getInfo(cl.PLATFORM_NAME); });
DPOPlatform.prototype.__defineGetter__("vendor", function() { return platform.getInfo(cl.PLATFORM_VENDOR); });
DPOPlatform.prototype.__defineGetter__("profile", function() { return platform.getInfo(cl.PLATFORM_PROFILE); });
DPOPlatform.prototype.__defineGetter__("extensions", function() { return platform.getInfo(cl.PLATFORM_EXTENSIONS); });
DPOPlatform.prototype.__defineGetter__("platform", function() { return platform; });
exports.DPOPlatform=DPOPlatform;

function DPOContext() {
  this.dpoPlatform;
  this.device;
  this.queue;
  this.context;
}
util.inherits(DPOContext, dpoIContext);
DPOContext.prototype.init = function(p) {
  this.dpoPlatform=p;

  try {
    this.context=cl.createContext({
      deviceType: cl.DEVICE_TYPE_GPU,
      platform: this.dpoPlatform.platform
    });
  } catch(ex) {
    log("can't create context. Err="+ex);
    exit(-1);
  }

  try {
    var devices=this.context.getInfo(cl.CONTEXT_DEVICES);
    this.device=devices[0];
    this.queue = this.context.createCommandQueue(this.device);
  } catch(ex) {
    log("can't create command queue. Err="+ex);
  }

  log('creating kernelFailureMem internal object')
  this.kernelFailureMem = this.context.createBuffer(cl.MEM_READ_WRITE, Uint32Array.BYTES_PER_ELEMENT, null);
}

// Functions for generating kernels.
DPOContext.prototype.compileKernel = function( source, kernelName, options)
{
  //log('[compileKernel] source='+source+' kernelName='+kernelName+' options= '+options);
  log('creating program')
  var program = this.context.createProgram(source);
  log('build program')
  try {
    program.build(this.device);
  } catch (err) {
    log('Error building program: ' + err);
  }
  /*log("Build Status: "
    + program.getBuildInfo(this.device, cl.PROGRAM_BUILD_STATUS));
  log("Build Options: "
    + program.getBuildInfo(this.device, cl.PROGRAM_BUILD_OPTIONS));*/
  this.buildLog=program.getBuildInfo(this.device, cl.PROGRAM_BUILD_LOG);
  log("Build Log: " + this.buildLog);

  log('creating kernel')
  var clKernel = program.createKernel(kernelName);
  this.kernel=new DPOCKernel(this);

  log('kernel init')
  this.kernel.init(this.queue, clKernel, this.kernelFailureMem);

  return this.kernel; // DPOCKernel
}

DPOContext.prototype.allocateData=function(tArray, length)
{
  var bytePerElements = tArray.BYTES_PER_ELEMENT;
  if (length == 0)
    length = tArray.byteLength/bytePerElements;

  log("[AllocateData] length " + length + " bytePerElements " + bytePerElements);

  //var memObj = this.context.createBuffer(cl.MEM_USE_HOST_PTR | cl.MEM_READ_WRITE, length * bytePerElements, tArray);
  var memObj = this.context.createBuffer(cl.MEM_READ_WRITE, length * bytePerElements);

  var type=-1;
  if( tArray instanceof Int8Array) type=0;
  else if( tArray instanceof Uint8Array) type=1;
  else if( tArray instanceof Int16Array) type=2;
  else if( tArray instanceof Uint16Array) type=3;
  else if( tArray instanceof Int32Array) type=4;
  else if( tArray instanceof Uint32Array) type=5;
  else if( tArray instanceof Float32Array) type=6;
  else if( tArray instanceof Float64Array) type=7;
  else if( tArray instanceof Uint8ClampedArray) type=8;
  //log('creating CData for TypedArray '+util.inspect(tArray)+' type: '+type);
  var data=new DPOCData(this.context, this.queue, memObj, type, length, length * bytePerElements, null);

  return data;
}

function DPOCData(ctx, aQueue, aMemObj, aType, aLength, aSize, anArray) {
  this.size=aSize;        // size in bytes
  this.type=aType;        // Typed Array type
  this.length=aLength;    // number of elements in array
  this.memObj=aMemObj;    // associated WebCLBuffer
  this.queue=aQueue;      // WebCLCommandQueue
  this.theArray=anArray;  // typed array
  this.theContext=ctx;    // WebCLContext
}
util.inherits(DPOCData, dpoIData);

DPOCData.prototype.writeTo= function(dest) {
  this.queue.enqueueReadBuffer(this.memObj, cl.TRUE, dest);
  return cl.SUCCESS;
}
DPOCData.prototype.getValue= function() {
  if(this.theArray!=null)
    return this.theArray;

  var jsArray = null;
  if(this.type==0) jsArray=new Int8Array(this.length);
  else if(this.type==1) jsArray=new Uint8Array(this.length);
  else if(this.type==2) jsArray=new Int16Array(this.length);
  else if(this.type==3) jsArray=new Uint16Array(this.length);
  else if(this.type==4) jsArray=new Int32Array(this.length);
  else if(this.type==5) jsArray=new Uint32Array(this.length);
  else if(this.type==6) jsArray=new Float32Array(this.length);
  else if(this.type==7) jsArray=new Float64Array(this.length);
  else if(this.type==8) jsArray=new Uint8ClampedArray(this.length);
  else
    jsArray=new ArrayBuffer(this.size);

  //log('CData.getValue: queue='+util.inspect(this.queue)+' memObj='+this.memObj)
  this.queue.enqueueReadBuffer(this.memObj, cl.TRUE, {
    buffer: jsArray,
    size: jsArray.byteLength
  });

  return jsArray;
}

function DPOCKernel(ctx) {
  this.context=ctx; // DPOContext
  this.kernel; // WebCLKernel
  this.cmdQueue; // WebCLCommandQueue
  this.failureMem ; // WebCLMemObject
  this.DPO_NUMBER_OF_ARTIFICIAL_ARGS=1;
}
util.inherits(DPOCKernel, dpoIKernel);
DPOCKernel.prototype.init=function(aCmdQueue, aKernel, aFailureMem) {
  this.kernel=aKernel; // WebCLKernel
  this.cmdQueue = aCmdQueue; // WebCLCommandQueue
  this.failureMem = aFailureMem; // WebCLMemObject

  log('kernel='+this.kernel+' cmdQueue='+this.cmdQueue)
  log('setting internal arg 0 (failureMem object)')
  this.kernel.setArg(0, this.failureMem);
}

DPOCKernel.prototype.getNumberOfArgs= function() {
  return this.kernel.getInfo(cl.KERNEL_NUM_ARGS) - this.DPO_NUMBER_OF_ARTIFICIAL_ARGS;
}

// Methods to supply arguments to a kernel.
DPOCKernel.prototype.setArgument= function ( number, buffer) {
  log('setArg buffer: idx='+number+' buffer: '+util.inspect(buffer,null,true,null))
  this.kernel.setArg(number + this.DPO_NUMBER_OF_ARTIFICIAL_ARGS, buffer.memObj);
}

DPOCKernel.prototype.setScalarArgument= function (number, value, isInteger, isHighPrecision) {
  log('set scalar arg: idx='+number+' value='+value+' isInteger='+isInteger+' isHighPrecision='+isHighPrecision)
  /* skip internal arguments */
  number = number + this.DPO_NUMBER_OF_ARTIFICIAL_ARGS;

  if(isInteger) {
    this.kernel.setArg(number, value, cl.type.INT);
  }
  else if (isHighPrecision) {
    this.kernel.setArg(number, value, cl.type.DOUBLE);
  } else {
    this.kernel.setArg(number, value, cl.type.FLOAT);
  }
}

// Methods to run a kernel
DPOCKernel.prototype.run= function (rank, shape, tile) {
  var writeEvent=new cl.WebCLEvent(), runEvent=new cl.WebCLEvent(), readEvent=new cl.WebCLEvent();
  var zero=new Int32Array(1), retVal=new Int32Array(1);
  var global_work_size=[],local_work_size=[];
  for(var i=0;i<rank;++i) {
    global_work_size[i]=shape[i];
    local_work_size[i]=tile[i];
  }

  log('running kernel rank='+rank+' shape='+shape+' tile='+tile)
  log('  enqueueWriteBuffer of zero array. cmdQueue='+this.cmdQueue);

  this.cmdQueue.enqueueWriteBuffer(this.failureMem, cl.FALSE, {
    offset: 0,
    size: Int32Array.BYTES_PER_ELEMENT,
    buffer: zero
  }, null, writeEvent);

  log('  enqueueNDRangeKernel')
  this.cmdQueue.enqueueNDRangeKernel(this.kernel, null, global_work_size, local_work_size, [writeEvent], runEvent);

  log('  enqueueReadBuffer of retVal')
  this.cmdQueue.enqueueReadBuffer(this.failureMem, cl.FALSE, {
    offset: 0,
    size: Int32Array.BYTES_PER_ELEMENT,
    buffer: retVal
  }, [runEvent], readEvent);

  // For now we always wait for the run to complete.
  // In the long run, we may want to interleave this with JS execution and only sync on result read.
  log('  waiting for CL to complete')
  cl.waitForEvents( [readEvent] );
  log('  run kernel END')
}
