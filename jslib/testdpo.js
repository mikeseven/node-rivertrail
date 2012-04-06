
var dpo=require(__dirname+'/dpoInterface.js'),
  Components=dpo.Components,
  DPOInterface=dpo.DPOInterface,
  DPOPlatform=dpo.DPOPlatform;
var util=require('util');
var log=console.log;

//log(util.inspect(Components,true,2,true));

log('Components.interfaces.dpoIInterface: '+Components.interfaces.dpoIInterface);
log(util.inspect(Components.interfaces.dpoIInterface,true,2,true));

var itf=new DPOInterface();
log(util.inspect(DPOInterface,true,2,true));

var platform=itf.getPlatform();
log('platform name: '+platform.name+' vendor: '+platform.vendor+" profile: "+platform.profile);
log('is platform an instance of dpoIPlatform: '+(platform instanceof Components.interfaces.dpoIPlatform));
log(util.inspect(platform,true,null,true));

var ctx=platform.createContext();
log('Context: '+util.inspect(ctx,true,null,true));
log('is ctx an instance of dpoIContext: '+(ctx instanceof Components.interfaces.dpoIContext));
