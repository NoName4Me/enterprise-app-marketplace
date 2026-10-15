import {describe,it,expect} from "vitest";
import {parseReadyHistory} from "./ops-series";
const start=1792000000, end=start+3600;
describe("Prometheus history parser",()=>{
 it("accepts a single aggregate matrix series within requested time boundaries",()=>{
  expect(parseReadyHistory({status:"success",data:{resultType:"matrix",result:[
   {metric:{},values:[[start, "1"],[start+300,"2"],[start+600,"3"]]},
  ]}},start,end)).toEqual([
    {at:new Date(start*1000).toISOString(),value:1},
    {at:new Date((start+300)*1000).toISOString(),value:2},
    {at:new Date((start+600)*1000).toISOString(),value:3},
  ]);
 });
 it("rejects ambiguous multi-series, bad values and out-of-range time",()=>{
  expect(parseReadyHistory({status:"success",data:{resultType:"vector",result:[]}},start,end)).toEqual([]);
  expect(parseReadyHistory({status:"success",data:{resultType:"matrix",result:[
    {values:[[start,"1"]]},{values:[[start,"5"]]},
  ]}},start,end)).toEqual([]);
  expect(parseReadyHistory({status:"success",data:{resultType:"matrix",result:[
    {values:[[start-5,"1"],[start+5,"NaN"],[start+10,"-1"],[start+12,"2"]]},
  ]}},start,end)).toEqual([{at:new Date((start+12)*1000).toISOString(),value:2}]);
 });
});
