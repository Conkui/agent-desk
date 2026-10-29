import {expect,test} from "bun:test";
import {OpenCodeRuntime} from "./index";

function fixture(denied=false){
 const runtime=new OpenCodeRuntime("unused","unused",{} as any) as any;
 const native={abort:new AbortController(),sessions:new Map([["member","session"]]),observers:new Map(),profile:{model:"local-test"},deniedSessions:new Set(denied?["session"]:[]),permissionReplies:new Map()};
 runtime.start=async()=>native;
 runtime.request=async()=>({info:{finish:"tool-calls"},parts:[]});
 return {runtime,native,execute:()=>runtime.execute({id:"run",definition:{}},{id:"member"},"short",()=>{})};
}
test("a native response ending at tool calls is never accepted as a completed result",async()=>{
 const f=fixture();await expect(f.execute()).rejects.toMatchObject({code:"runtime_incomplete"});
});
test("a denied native turn waits for the reply acknowledgement before cleanup can start",async()=>{
 const f=fixture(true);let release!:()=>void;
 f.native.permissionReplies.set("session",new Promise<void>(resolve=>release=resolve));
 let settled=false;const execution=f.execute().finally(()=>settled=true);
 await Bun.sleep(10);expect(settled).toBe(false);
 release();await expect(execution).rejects.toMatchObject({code:"runtime_permission_denied"});
});
