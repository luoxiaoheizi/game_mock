import {config} from './config';
import {storageKey} from './services/api';
App({
  onLaunch(){if(config.mode==='cloud'){wx.cloud.init({env:config.cloudEnv,traceUser:true});}},
  onShow(options){if(options.query?.invite)wx.setStorageSync(storageKey('incoming-invite'),options.query.invite);}
});
