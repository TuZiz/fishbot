import { boundedBody, downloadImage, saveImage } from './artifact.js';

export interface ImageProvider { url:string; key:string; model:string }
export interface ImageClientOptions { timeoutMs?:number; downloadOrigins?:string[] }
export interface ImageRequest { prompt:string; reference?:{ bytes:Uint8Array; mime:string } }
export interface ImageGenerator { generate(request:ImageRequest,signal:AbortSignal):Promise<string> }
// HTTP rejections may use the backup. An ambiguous timeout/network failure is never retried:
// the first provider may already have charged for a completed image.
export class ImageClient implements ImageGenerator {
  constructor(private providers:ImageProvider[],private directory='data/generated',private fetcher:typeof fetch=fetch,private options:ImageClientOptions={}) {}
  async generate(request:ImageRequest,signal:AbortSignal):Promise<string> {
    if(!this.providers.length)throw Error('Image API is not configured');
    const deadline=AbortSignal.any([signal,AbortSignal.timeout(this.options.timeoutMs??180000)]);
    for(const [index,p] of this.providers.entries()) {
      signal.throwIfAborted();
      let body:BodyInit;
      const headers:Record<string,string>={Authorization:`Bearer ${p.key}`};
      if(request.reference){const form=new FormData();form.set('model',p.model);form.set('prompt','请编辑随请求上传的参考图片。除用户明确要求修改的部分外，保留原图主体、构图和文字，不要生成无关画面。\n用户要求：'+request.prompt);form.set('n','1');form.set('image',new Blob([new Uint8Array(request.reference.bytes)],{type:request.reference.mime}),'reference.png');body=form;}
      else {headers['Content-Type']='application/json';body=JSON.stringify({model:p.model,prompt:request.prompt,n:1,response_format:'b64_json'});}
      let response:Response;
      try{response=await this.fetcher(`${p.url.replace(/\/$/,'')}/images/${request.reference?'edits':'generations'}`,{method:'POST',headers,body,signal:deadline,redirect:'error'});}
      catch(error){
        if(signal.aborted)throw error;
        const cause=error&&typeof error==='object'&&'cause' in error?error.cause:undefined;
        const code=cause&&typeof cause==='object'&&'code' in cause?String(cause.code):'';
        const safe=/^(UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(code)?code:error instanceof Error&&error.name==='TimeoutError'?'TIMEOUT':'FAILED';
        throw Error(`Image network ${safe}`);
      }
      if(!response.ok){await response.body?.cancel();if([401,403,404,429].includes(response.status)&&index+1<this.providers.length)continue;throw Error(`Image HTTP ${response.status}`);}
      const data=JSON.parse((await boundedBody(response,29_000_000)).toString('utf8')) as {data?:{b64_json?:string;url?:string}[]};
      const item=data.data?.[0];
      if(!item)throw Error('Image response has no image');
      const origins=new Set([new URL(p.url).origin,...(this.options.downloadOrigins??[])]);
      const bytes=item.b64_json?Buffer.from(item.b64_json,'base64'):item.url?await downloadImage(item.url,origins,this.fetcher,deadline):null;
      if(!bytes)throw Error('Image response has no image bytes or URL');
      return saveImage(bytes,this.directory,deadline);
    }
    throw Error('Image API unavailable');
  }
}
