// Quoted-photo context permits arbitrary subjects, not just a fixed noun list.
// Keep an explicit request grammar: discussion/negation must never spend money.
const subjectAction='(?:替换(?:成|为)?|更换(?:成|为)?|修改(?:成|为)?|调整(?:成|为)?'
  +'|改(?:成|为|一下|一改|红|蓝|绿|黑|白)|换(?:成|为|到|一下|个|一)|移到|放到'
  +'|变成|变为|变得|变(?:红|蓝|绿|黄|黑|白|紫|粉|大|小|亮|暗|胖|瘦)|染成|涂成|上色'
  +'|去掉|去除|移除|删除|删掉|擦掉|抹掉|消除|修复|修好|修一下|美化|优化|重绘'
  +'|裁剪|裁掉|抠出|虚化|模糊|锐化|调亮|调暗|调大|调小|提亮|增亮|压暗|放大|缩小|拉长|拉近|拉远|磨皮|美白)';
const subjectChange=new RegExp('^(?:把|将|让|给)\\s*[^。！？!?；;\\r\\n]{1,100}?'+subjectAction);
const subjectAddition=/^给\s*[^。！？!?；;\r\n]{1,100}?(?:加上|加个|加一|添加|增加|添上|补上|戴上|戴顶|戴一|穿上|穿件|穿一|换上|配上|装上|画上)/;
const imageSubjectChange=new RegExp('^(?:这张|这个|这幅|该|引用的|原)?(?:图片|照片|图)(?:里|中|上)(?:面)?的?\\s*[^。！？!?；;\\r\\n]{1,80}?'+subjectAction);
const directEdit=/^(?:去掉|去除|移除|删除|删掉|擦掉|抹掉|消除|添加|增加|加上|加个|加一|添上|补上|画上|修复|修好|修一下|修图|改图|重绘|扩图|抠图|去水印|裁剪|裁掉|旋转|翻转|调亮|调暗|提亮|增亮|压暗|锐化|虚化|模糊|磨皮|美白|上色|放大|缩小|拉长|拉近|拉远|换个|换一)/;

function isDiscussion(request:string):boolean {
  return /^(?:如果|假如|假设|要是|据说|听说|有人说|我朋友|朋友说|你觉得|你认为|为什么|怎么|如何|不要|别|不必|不用|不需要|先别|能不能解释)/.test(request)
    || /(?:会不会|是不是|好不好看|好看吗|怎么样|什么意思|怎么做|如何做|支持吗|可行吗|能做到吗)[？?！!。\s]*$/.test(request);
}

export function imageIntent(text:string,quotedImage=false):{prompt:string;edit:boolean}|null {
  // WeChat mention separators include U+2005; only remove edge mentions.
  // A literal email or an @ inside an editing instruction stays intact.
  let value=text.trim().replace(/^(?:@\S+\s+)+/,'').trim();
  const trailingMentions=/(?:\s+@\S+)+\s*$/.exec(value);
  // A literal replacement such as "文字改成 @example" is image content.
  if(trailingMentions&&!/(?:改成|改为|换成|换为|替换为|替换成|修改为|修改成|变成|变为|添加|写成|写上)\s*$/.test(value.slice(0,trailingMentions.index)))value=value.slice(0,trailingMentions.index).trim();
  const request=value.replace(/^(?:(?:请问|请|帮我|给我|麻烦你|麻烦|帮忙|可以帮我|能帮我|能不能|能否|可以)\s*)+/,'');
  if(isDiscussion(request))return null;
  const edit=/^(?:(?:请|帮我|给我)\s*)*(美化|修改|编辑|重绘|优化)(?:一下)?(?:这张|引用的|这幅|该)?(?:图片|照片|图)/.exec(value);
  if(edit)return {prompt:value,edit:true};
  const quotedChange=/^(?:把|将)?\s*(?:(?:这张|这个|这幅|该|引用的|原)?(?:图片|照片|图)(?:的)?)?\s*(?:背景|底色|颜色|色调|风格|衣服|服装|发型|光线|亮度|人物|主体)(?:给我)?(?:换|改|调|变|替换|去掉|移除)/.test(request)
    ||/^(?:换|更换|替换|修改|调整|改|去掉|移除|添加|加上|去除|保留|美化|优化|修复|修一下|修图|改图|重绘|扩图|抠图|去水印)(?:一下|个|成|为|这张|这个|图片|照片|图|背景|底色|颜色|色调|风格|衣服|服装|发型|光线|亮度|人物|主体|水印|\s|$)/.test(request);
  const quotedObjectChange=/^(?:把|将)\s*(?:这张|这个|这幅|该|引用的|原)?(?:图片|照片|图)\s*(?:给我)?\s*(?:改成|改为|换成|换为|变成|变为|修改为|修改成|调整成|调整为|美化|优化|重绘|编辑)/.test(request);
  if(quotedImage&&(quotedChange||quotedObjectChange||subjectChange.test(request)||subjectAddition.test(request)||imageSubjectChange.test(request)||directEdit.test(request)))return {prompt:value,edit:true};
  const generate=/^(?:(?:请|帮我|给我|我要|我想要)\s*)*(?:生图|生成(?:一张|一幅|个)?(?:图片|图像|图)|画(?:一张|一幅|个))\s*[:：，,]?\s*/.exec(value);
  return generate?{prompt:value.slice(generate[0].length).trim(),edit:false}:null;
}
