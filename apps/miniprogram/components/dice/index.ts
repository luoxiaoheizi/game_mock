const faces:Record<number,number[]>={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
Component({
  properties:{value:{type:Number,value:1},rolling:{type:Boolean,value:false}},
  data:{dots:Array.from({length:9},(_,i)=>({i,on:i===4}))},
  observers:{value(value:number){this.setData({dots:Array.from({length:9},(_,i)=>({i,on:(faces[value]||faces[1]).includes(i)}))});}}
});
