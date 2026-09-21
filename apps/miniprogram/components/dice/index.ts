const faces:Record<number,number[]>={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
function dots(value:number){return Array.from({length:9},(_,i)=>({i,on:(faces[value]||faces[1]).includes(i)}));}
function sides(value:number){
  const front=faces[value]?value:1,side=front===1||front===6?2:1;
  const top=[1,2,3,4,5,6].find(v=>![front,7-front,side,7-side].includes(v))!;
  return [front,7-front,side,7-side,top,7-top].map((n,i)=>({i,value:n,dots:dots(n)}));
}
Component({
  properties:{value:{type:Number,value:1},rolling:{type:Boolean,value:false},spatial:{type:Boolean,value:false}},
  data:{dots:dots(1),sides:sides(1)},
  observers:{value(value:number){this.setData({dots:dots(value),sides:sides(value)});}}
});
