import test from 'node:test';
import assert from 'node:assert/strict';
import {imageIntent} from '../src/images/intent.js';

const edits={
 'subject and colour':[
  '把这个图片的猫变成红色','把猫变红','将图里的狗换成猫','让这只猫变成蓝色',
  '把照片中汽车的颜色改为黑色','把图片上的花染成紫色','把小猫的眼睛改成绿色',
  '图片里的猫变成红色','照片中的天空换成蓝色','图上人物的衣服变成白色',
  '把猫的颜色改一下','把背景换一下','把这只猫改红一点',
 ],
 'background and scene':[
  '把背景换成火星','把这个图片改成脚踩地球','将照片变为水彩风格',
  '背景换成沙滩','把背景中的房子换成城堡','将人物移到海边',
  '把猫放到月球上','把天空变成星空','给人物换上宇航服',
  '换个夕阳背景','换一个雪山背景','把图片的风格修改为漫画',
 ],
 'add and remove':[
  '给猫戴顶帽子','给照片里的人戴上墨镜','给小狗穿一件红衣服',
  '给背景加上彩虹','给猫配上翅膀','给人物画上胡子','给树补上叶子',
  '添加一只小猫','加个太阳','加一行标题','增加雨天效果','画上几朵云',
  '去掉水印','删除背景里的路人','移除右边的垃圾桶','擦掉左上角的字',
  '把背景里的人去掉','将右侧电线抹掉','把左边的花删除','消除脸上的痘痘',
 ],
 'portrait and image adjustments':[
  '帮我美化这张照片','修图，让画面自然一点','修一下肤色','给我磨皮',
  '美白一点','提亮人物','调暗背景','锐化细节','虚化背景','模糊车牌',
  '把人物放大一点','把背景缩小','把裙子拉长','把镜头拉近','把画面压暗一点',
  '裁剪掉右边空白','裁掉左边的一半','旋转90度','翻转图片','抠图，保留猫',
  '扩图到16比9','给黑白照片上色','修复这张老照片','把人脸修复一下',
 ],
 'text editing and polite requests':[
  '把图片里的文字改成你好','将标题替换为欢迎光临','把招牌上的字擦掉',
  '请帮我把这个图片的猫变成红色','麻烦你给猫戴顶帽子','可以帮我把背景换成夜晚吗',
  '能不能把衣服换成蓝色','能否将照片变成素描','帮忙把车牌模糊一下',
  '请问可以把图片的颜色改为暖色吗','把文字改成“请不要吸烟”',
 ],
};
for(const [category,cases] of Object.entries(edits)){
 test('quoted image intent batch: '+category,t=>{
  t.diagnostic(`${cases.length} explicit editing phrases`);
  for(const text of cases)assert.equal(imageIntent(text,true)?.edit,true,text);
 });
}

test('mentions at either edge and WeChat whitespace preserve the editing instruction',()=>{
 const prompt='把这个图片的猫变成红色';
 for(const text of [prompt,'@机器人 '+prompt,prompt+' @机器人','@机器人\u2005'+prompt,prompt+'\u2005@机器人','@机器人 '+prompt+' @另一个名字']){
  assert.deepEqual(imageIntent(text,true),{edit:true,prompt});
 }
 const email='把图片里的文字改成 fish@example.com';
 assert.equal(imageIntent(email+' @机器人',true)?.prompt,email);
 const literal='把图片里的文字改成 @example';
 assert.equal(imageIntent(literal,true)?.prompt,literal);
});

const discussion=[
 '你好','这个猫真好看','图片里的猫是红色的','这张照片怎么拍的','这张图是什么风格',
 '你觉得把猫变红怎么样','我朋友说把图改成漫画好看','有人说去掉水印就好看',
 '为什么把猫变成红色','怎么把猫变成红色','如何把背景换掉','如果把猫变红会怎样',
 '假如把人物放到月球上呢','要是把背景换成黑色就好了','不要把猫变成红色',
 '别修改这张图片','不用修图','不需要美化图片','先别去掉背景','能不能解释一下修图原理',
 '把这只猫变成红色好看吗','把猫变红怎么样','将图片转为漫画可行吗','把猫变红是什么意思',
 '据说把背景虚化就好了','请不要把图片改成黑白','你认为给猫戴帽子好不好看',
 '美化这张图片是什么意思','这图片改成黑白会不会更好看','帮我看看这张图',
 '识别图片里的文字','提取照片中的文字','你能处理图片吗',
];
test('discussion, negation, tutorials and OCR questions never become paid image requests',t=>{
 t.diagnostic(`${discussion.length} negative phrases`);
 for(const text of discussion)assert.equal(imageIntent(text,true),null,text);
});

test('subject operations require a quoted photo instead of spending on ordinary text',()=>{
 for(const text of ['把猫变红','给猫戴顶帽子','把这个图片的猫变成红色','移除右边的垃圾桶','把文字改成你好','虚化背景','图片里的猫变成红色'])assert.equal(imageIntent(text),null,text);
});
