/**
 * 报告渲染（HTML 四视图 + Markdown）。
 * 分析逻辑不在这里重复实现——renderReportHTML 把 metrics.cjs 的 analyze/diff 纯函数
 * 以 toString() 注入浏览器，界面所有视图与筛选都调用同一份 analyze，保证与 Markdown 导出一致。
 * 浏览器脚本一律用字符串拼接（无模板串/无 ${}），避免与 Node 模板字面量冲突。
 */

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ─── Markdown（贴 Jira / 存档） ───────────────────────────
function renderReportMarkdown(runs, fns) {
  const st = fns.analyze(runs, {});
  const s = st.summary;
  const L = [];
  const fmtT = (t) => (t ? new Date(t).toLocaleString('zh-CN') : '-');
  L.push('# ReqMock 请求总览报告', '');
  L.push(`- 范围：${fmtT(s.from)} ~ ${fmtT(s.to)}（${s.spanDays} 天）`);
  L.push(`- 请求 ${s.total} 次，成功 ${s.ok} / 失败 ${s.fail}（失败率 ${(s.failRate * 100).toFixed(1)}%）`);
  L.push(`- 耗时 平均 ${s.avg}ms / P50 ${s.p50}ms / P95 ${s.p95}ms / 最慢 ${s.maxMs}ms`);
  L.push(`- 覆盖 ${s.endpoints} 个接口、${s.hosts} 个域名；来源 ${Object.keys(s.bySrc).map((k) => k + ':' + s.bySrc[k]).join('、')}`);
  L.push('');
  L.push('## 结论与建议');
  L.push('');
  if (!st.insights.length) L.push('- （无明显异常）');
  st.insights.forEach((it) => L.push(`- **[${it.sev === 'high' ? '高' : it.sev === 'mid' ? '中' : '信息'}] ${it.title}**：${it.detail}`));
  L.push('');
  L.push('## 慢接口 Top（按 P95）', '', '| 接口 | 次数 | 失败 | 平均 | P95 |', '|---|---|---|---|---|');
  st.topSlow.forEach((e) => L.push(`| ${e.key} | ${e.count} | ${e.fail} | ${e.avg}ms | ${e.p95}ms |`));
  L.push('');
  L.push('## 接口明细', '', '| 接口 | 次数 | 失败 | 平均 | P95 |', '|---|---|---|---|---|');
  st.endpoints.slice(0, 40).forEach((e) => L.push(`| ${e.key} | ${e.count} | ${e.fail} | ${e.avg}ms | ${e.p95}ms |`));
  return L.join('\n');
}

// ─── HTML 四视图 ──────────────────────────────────────────
function renderReportHTML(runs, fns) {
  const embedded = (runs || []).slice(-3000);
  const runsJson = JSON.stringify(embedded);
  const gen = new Date().toLocaleString('zh-CN');
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ReqMock 请求总览</title>
<style>
:root{--bg:#15161a;--bg2:#1c1e24;--bg3:#232630;--line:#2e323c;--fg:#e8e6e3;--fg2:#9a9da8;--ac:#f0a04b;--ok:#4cc38a;--err:#e5484d;--warn:#f5a524;--mono:Consolas,'JetBrains Mono',monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:13px/1.6 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif}
header{position:sticky;top:0;background:var(--bg2);border-bottom:1px solid var(--line);padding:12px 22px;z-index:5}
h1{font-size:16px;color:var(--ac);display:inline-block}
.sub{color:var(--fg2);font-size:11.5px;margin-left:12px}
.filters{margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.filters .fl{font-size:11.5px;color:var(--fg2)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.seg button{background:transparent;border:none;color:var(--fg2);padding:3px 10px;cursor:pointer;font-size:11.5px}
.seg button.on{background:var(--ac);color:#1a1208;font-weight:600}
select{background:var(--bg3);border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:3px 8px;font-size:11.5px}
nav{display:flex;gap:2px;padding:0 22px;background:var(--bg2);border-bottom:1px solid var(--line)}
nav button{background:transparent;border:none;border-bottom:2px solid transparent;color:var(--fg2);padding:9px 16px;cursor:pointer;font-size:13px}
nav button.on{color:var(--ac);border-bottom-color:var(--ac)}
main{padding:18px 22px;max-width:1180px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:18px}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.card .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.card .l{color:var(--fg2);font-size:11px;margin-top:2px}
.insight{display:flex;gap:10px;align-items:flex-start;background:var(--bg2);border:1px solid var(--line);border-left-width:3px;border-radius:8px;padding:11px 14px;margin-bottom:9px}
.insight.high{border-left-color:var(--err)}.insight.mid{border-left-color:var(--warn)}.insight.info{border-left-color:var(--fg2)}
.insight .ic{font-size:16px;line-height:1.4}
.insight .tt{font-weight:700}.insight .dt{color:var(--fg2);font-size:12px;margin-top:1px}
.insight .ev{margin-left:auto;background:transparent;border:1px solid var(--line);color:var(--ac);border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11.5px;white-space:nowrap;align-self:center}
.insight .ev:hover{border-color:var(--ac)}
h2{font-size:13px;margin:18px 0 9px;color:var(--fg)}
.chart{display:flex;align-items:flex-end;gap:3px;height:110px;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:12px}
.chart .b{flex:1;min-width:5px;background:linear-gradient(180deg,var(--ac),#b97a34);border-radius:3px 3px 0 0;position:relative}
.chart .b:hover::after{content:attr(data-t);position:absolute;bottom:102%;left:50%;transform:translateX(-50%);background:var(--bg3);border:1px solid var(--line);padding:2px 7px;border-radius:5px;white-space:nowrap;font-size:10.5px;z-index:2}
.xl{display:flex;gap:3px;margin-top:3px}.xl span{flex:1;min-width:5px;text-align:center;color:var(--fg2);font-size:9.5px;overflow:hidden}
.hist{display:flex;align-items:flex-end;gap:8px;height:90px;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:12px}
.hist .h{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.hist .h i{width:70%;background:var(--ac);border-radius:3px 3px 0 0;min-height:2px}
.hist .h b{font-size:10.5px;color:var(--fg);margin-bottom:3px}.hist .h em{font-size:10px;color:var(--fg2);font-style:normal;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{color:var(--fg2);text-align:left;padding:6px 9px;border-bottom:1px solid var(--line);font-weight:600;position:sticky;top:0;background:var(--bg)}
td{padding:6px 9px;border-bottom:1px solid var(--line)}
tr.clk{cursor:pointer}tr.clk:hover td{background:var(--bg2)}
.mono{font-family:Consolas,monospace;font-variant-numeric:tabular-nums}
.ok{color:var(--ok)}.bad{color:var(--err)}.dim{color:var(--fg2)}
.bar{background:var(--bg3);height:7px;border-radius:4px;width:90px;overflow:hidden;display:inline-block;vertical-align:middle}
.bar i{display:block;height:100%;background:var(--ac)}
.chip{font-size:10px;border:1px solid var(--line);border-radius:4px;padding:0 6px;color:var(--fg2)}
.delta-up{color:var(--err)}.delta-dn{color:var(--ok)}
/* 钻取抽屉 */
#drawer{position:fixed;top:0;right:0;width:min(680px,92vw);height:100vh;background:var(--bg2);border-left:1px solid var(--line);box-shadow:-8px 0 30px rgba(0,0,0,.4);transform:translateX(100%);transition:transform .2s;z-index:20;display:flex;flex-direction:column}
#drawer.open{transform:none}
#drawer .dh{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)}
#drawer .dh .t{font-weight:700;font-family:var(--mono);font-size:12.5px;word-break:break-all}
#drawer .dh .x{margin-left:auto;background:transparent;border:1px solid var(--line);color:var(--fg2);border-radius:6px;padding:2px 10px;cursor:pointer}
#drawer .db{overflow-y:auto;padding:14px 16px}
.runrow{border:1px solid var(--line);border-radius:7px;padding:6px 10px;margin-bottom:6px;font-size:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.runrow .idx{color:var(--fg2);font-family:var(--mono)}
.chg{font-size:11px;color:var(--fg2);margin-left:6px}
.chg .k{color:var(--ac)}.chg .from{color:var(--err);text-decoration:line-through}.chg .to{color:var(--ok)}
.difftbl td{font-family:var(--mono);font-size:11px;word-break:break-all}
.difftbl .del{color:var(--err)}.difftbl .add{color:var(--ok)}
.sect{margin:14px 0 6px;color:var(--fg2);font-size:11.5px;font-weight:600}
.empty{color:var(--fg2);text-align:center;padding:40px}
</style></head>
<body>
<header>
  <h1>ReqMock 请求总览</h1><span class="sub">生成于 ${esc(gen)} · 数据 ${embedded.length} 条${(runs||[]).length>embedded.length?'（共 '+(runs||[]).length+'，嵌入最近 3000）':''}</span>
  <div class="filters">
    <span class="fl">时间</span>
    <span class="seg" id="rangeSeg"></span>
    <span class="fl" style="margin-left:10px">来源</span>
    <select id="srcSel"></select>
    <span class="fl" style="margin-left:10px">域名</span>
    <select id="hostSel"></select>
  </div>
</header>
<nav id="nav"></nav>
<main id="main"></main>
<div id="drawer"><div class="dh"><span class="t" id="drTitle"></span><button class="x" onclick="closeDrill()">关闭</button></div><div class="db" id="drBody"></div></div>
<script>
var RUNS=${runsJson};
var analyze=${fns.analyze.toString()};
var diffJson=${fns.diffJson.toString()};
var fmtDiffValue=${fns.fmtDiffValue.toString()};
var diffParams=${fns.diffParams.toString()};
var TABS=[['insight','结论'],['dash','仪表盘'],['compare','对比'],['detail','明细']];
var state={tab:'insight',range:'all',src:'all',host:'all',cmp:'time'};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function ekey(r){return r.method+' '+r.path;}
function fmtT(t){return t?new Date(t).toLocaleString('zh-CN'):'-';}
function fmtHM(t){var d=new Date(t);return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function maxTs(){return RUNS.reduce(function(m,r){return Math.max(m,r.ts);},0);}
function curStats(){var from=0;if(state.range==='1d')from=maxTs()-86400000;else if(state.range==='7d')from=maxTs()-7*86400000;else if(state.range==='30d')from=maxTs()-30*86400000;return analyze(RUNS,{from:from,src:state.src,host:state.host});}
function uniq(fn){var s={},o=[];RUNS.forEach(function(r){var v=fn(r);if(v&&!(v in s)){s[v]=1;o.push(v);}});return o;}
// 顶部筛选控件
function initFilters(){
  var rs=[['all','全部'],['1d','近1天'],['7d','近7天'],['30d','近30天']];
  document.getElementById('rangeSeg').innerHTML=rs.map(function(x){return '<button data-r="'+x[0]+'" class="'+(state.range===x[0]?'on':'')+'">'+x[1]+'</button>';}).join('');
  document.querySelectorAll('#rangeSeg button').forEach(function(b){b.onclick=function(){state.range=b.dataset.r;initFilters();render();};});
  var srcs=['all'].concat(uniq(function(r){return r.src;}));
  document.getElementById('srcSel').innerHTML=srcs.map(function(s){return '<option value="'+s+'"'+(state.src===s?' selected':'')+'>'+(s==='all'?'全部来源':s)+'</option>';}).join('');
  document.getElementById('srcSel').onchange=function(e){state.src=e.target.value;render();};
  var hs=['all'].concat(uniq(function(r){return r.host;}));
  document.getElementById('hostSel').innerHTML=hs.map(function(s){return '<option value="'+s+'"'+(state.host===s?' selected':'')+'>'+(s==='all'?'全部域名':s)+'</option>';}).join('');
  document.getElementById('hostSel').onchange=function(e){state.host=e.target.value;render();};
}
function initNav(){document.getElementById('nav').innerHTML=TABS.map(function(t){return '<button data-t="'+t[0]+'" class="'+(state.tab===t[0]?'on':'')+'">'+t[1]+'</button>';}).join('');document.querySelectorAll('#nav button').forEach(function(b){b.onclick=function(){state.tab=b.dataset.t;initNav();render();};});}
function render(){var m=document.getElementById('main');var st=curStats();
  if(state.tab==='insight')m.innerHTML=viewInsight(st);
  else if(state.tab==='dash')m.innerHTML=viewDash(st);
  else if(state.tab==='compare')m.innerHTML=viewCompare(st);
  else m.innerHTML=viewDetail(st);
  bindDrill();
}
function viewInsight(st){
  var s=st.summary;
  var cards='<div class="cards">'+card(s.total,'总请求')+card(s.ok+' / '+s.fail,'成功 / 失败',s.fail?'var(--err)':'var(--ok)')+card((s.failRate*100).toFixed(1)+'%','失败率')+card(s.p95+'ms','P95')+card(s.endpoints,'接口数')+'</div>';
  if(!st.insights.length)return cards+'<div class="empty">未发现明显异常。数据量 '+s.total+' 条，整体平稳。</div>';
  return cards+'<h2>自动结论（'+st.insights.length+'）</h2>'+st.insights.map(function(it){return '<div class="insight '+it.sev+'"><span class="ic">'+it.icon+'</span><div><div class="tt">'+esc(it.title)+'</div><div class="dt">'+esc(it.detail)+'</div></div>'+(it.key?'<button class="ev" data-drill="'+esc(it.key)+'">查看证据 →</button>':'')+'</div>';}).join('');
}
function card(v,l,color){return '<div class="card"><div class="v"'+(color?' style="color:'+color+'"':'')+'>'+v+'</div><div class="l">'+l+'</div></div>';}
function viewDash(st){
  var s=st.summary;
  var days=st.timeseries;var mx=Math.max.apply(null,days.map(function(d){return d.count;}).concat([1]));
  var chart=days.length?'<div class="chart">'+days.map(function(d){return '<div class="b" data-t="'+d.date+': '+d.count+'次 / 失败'+d.fail+' / 均'+d.avgMs+'ms" style="height:'+Math.max(3,d.count/mx*100)+'%"></div>';}).join('')+'</div><div class="xl">'+days.map(function(d){return '<span>'+d.date.slice(5)+'</span>';}).join('')+'</div>':'<div class="empty">无时序</div>';
  var hmx=Math.max.apply(null,st.histogram.map(function(h){return h.count;}).concat([1]));
  var hist='<div class="hist">'+st.histogram.map(function(h){return '<div class="h"><b>'+h.count+'</b><i style="height:'+Math.max(2,h.count/hmx*70)+'%"></i><em>'+h.label+'</em></div>';}).join('')+'</div>';
  var top='<table><thead><tr><th>接口</th><th>次数</th><th>失败</th><th>平均</th><th>P95</th></tr></thead><tbody>'+st.topSlow.map(function(e){return '<tr class="clk" data-drill="'+esc(e.key)+'"><td class="mono">'+esc(e.key)+'</td><td class="mono">'+e.count+'</td><td class="mono '+(e.fail?'bad':'dim')+'">'+e.fail+'</td><td class="mono">'+e.avg+'ms</td><td class="mono">'+e.p95+'ms</td></tr>';}).join('')+'</tbody></table>';
  return '<div class="cards">'+card(s.total,'总请求')+card((s.failRate*100).toFixed(1)+'%','失败率',s.failRate>0.1?'var(--err)':'var(--ok)')+card(s.avg+'ms','平均')+card(s.p95+'ms','P95')+card(s.maxMs+'ms','最慢')+'</div><h2>按天请求量</h2>'+chart+'<h2>耗时分布</h2>'+hist+'<h2>慢接口 Top（点行钻取）</h2>'+top;
}
function groupBy(rs){var m={};rs.forEach(function(r){var k=ekey(r);(m[k]=m[k]||[]).push(r);});return m;}
function agg(list){var ok=list.filter(function(r){return r.ok;}).length;var st=list.map(function(r){return r.timeMs;}).sort(function(a,b){return a-b;});var p=function(q){return st.length?st[Math.min(st.length-1,Math.floor(q*st.length))]:0;};return {n:list.length,fail:list.length-ok,p95:p(0.95)};}
function viewCompare(st){
  var dims=[['time','前半段 vs 后半段'],['src','GUI vs Skill'],['host','域名 A vs B']];
  var bar='<div class="filters" style="margin:0 0 12px"><span class="fl">对比维度</span><span class="seg">'+dims.map(function(d){return '<button data-cmp="'+d[0]+'" class="'+(state.cmp===d[0]?'on':'')+'">'+d[1]+'</button>';}).join('')+'</span></div>';
  var A=[],B=[],la='A',lb='B';
  var src=RUNS.filter(function(r){return (state.src==='all'||r.src===state.src)&&(state.host==='all'||r.host===state.host);});
  if(state.cmp==='time'){var mn=Math.min.apply(null,src.map(function(r){return r.ts;}));var mx2=Math.max.apply(null,src.map(function(r){return r.ts;}));var mid=(mn+mx2)/2;A=src.filter(function(r){return r.ts<mid;});B=src.filter(function(r){return r.ts>=mid;});la='前半段';lb='后半段';}
  else if(state.cmp==='src'){A=src.filter(function(r){return r.src==='gui';});B=src.filter(function(r){return r.src==='skill';});la='GUI';lb='Skill';}
  else{var hs=uniq(function(r){return r.host;});var top2=hs.map(function(h){return {h:h,n:src.filter(function(r){return r.host===h;}).length};}).sort(function(a,b){return b.n-a.n;}).slice(0,2);A=src.filter(function(r){return r.host===(top2[0]||{}).h;});B=src.filter(function(r){return r.host===(top2[1]||{}).h;});la=(top2[0]||{}).h||'—';lb=(top2[1]||{}).h||'—';}
  if(!A.length||!B.length)return '<div class="empty">两侧数据不足，无法对比（'+la+' '+A.length+' 条 / '+lb+' '+B.length+' 条）</div>';
  var ga=groupBy(A),gb=groupBy(B);var keys={};Object.keys(ga).concat(Object.keys(gb)).forEach(function(k){keys[k]=1;});
  var rows=Object.keys(keys).map(function(k){var a=ga[k]?agg(ga[k]):{n:0,fail:0,p95:0};var b=gb[k]?agg(gb[k]):{n:0,fail:0,p95:0};var dp=b.p95-a.p95;var only=(a.n&&b.n)?'':(a.n?'仅'+la:'仅'+lb);return {k:k,a:a,b:b,dp:dp,only:only};}).sort(function(x,y){return (y.a.n+y.b.n)-(x.a.n+x.b.n);}).slice(0,40);
  return '<h2>对比维度</h2>'+bar+'<table><thead><tr><th>接口</th><th>'+esc(la)+' 次数</th><th>'+esc(lb)+' 次数</th><th>'+esc(la)+' P95</th><th>'+esc(lb)+' P95</th><th>Δ耗时</th><th></th></tr></thead><tbody>'+rows.map(function(r){return '<tr class="clk" data-drill="'+esc(r.k)+'"><td class="mono">'+esc(r.k)+(r.only?' <span class="chip">'+r.only+'</span>':'')+'</td><td class="mono">'+r.a.n+'</td><td class="mono">'+r.b.n+'</td><td class="mono">'+r.a.p95+'ms</td><td class="mono">'+r.b.p95+'ms</td><td class="mono '+(r.dp>0?'delta-up':'delta-dn')+'">'+(r.dp>0?'+':'')+r.dp+'ms</td><td></td></tr>';}).join('')+'</tbody></table>';
}
window.setCmp=function(d){state.cmp=d;render();};
function viewDetail(st){
  return '<h2>接口明细（点行钻取时间轴 + 参数变动 + 响应差异）</h2><table><thead><tr><th>接口</th><th>次数</th><th>失败</th><th>失败率</th><th>平均</th><th>P95</th><th>热度</th></tr></thead><tbody>'+st.endpoints.map(function(e){var mx=st.endpoints[0].count||1;return '<tr class="clk" data-drill="'+esc(e.key)+'"><td class="mono">'+esc(e.key)+'</td><td class="mono">'+e.count+'</td><td class="mono '+(e.fail?'bad':'dim')+'">'+e.fail+'</td><td class="mono '+(e.failRate>0.3?'bad':'')+'">'+(e.failRate*100).toFixed(0)+'%</td><td class="mono">'+e.avg+'ms</td><td class="mono">'+e.p95+'ms</td><td><span class="bar"><i style="width:'+(e.count/mx*100)+'%"></i></span></td></tr>';}).join('')+'</tbody></table>';
}
// ── 钻取抽屉 ──
function bindDrill(){document.querySelectorAll('[data-drill]').forEach(function(el){el.onclick=function(){openDrill(el.getAttribute('data-drill'));};});document.querySelectorAll('[data-cmp]').forEach(function(el){el.onclick=function(){state.cmp=el.getAttribute('data-cmp');render();};});}
function openDrill(key){
  var rs=RUNS.filter(function(r){return ekey(r)===key;}).sort(function(a,b){return b.ts-a.ts;});
  if(!rs.length){closeDrill();return;}
  document.getElementById('drTitle').textContent=key;
  var h='';
  h+='<div class="sect">发送时间轴（'+rs.length+' 次，新→旧，含相邻参数变动）</div>';
  rs.forEach(function(r,i){
    var prev=rs[i+1];var ch=prev?diffParams(prev.params,r.params):[];
    var bad=!r.ok;
    h+='<div class="runrow"><span class="idx">'+(rs.length-i)+'</span><span>'+fmtHM(r.ts)+'</span><span class="'+(bad?'bad':'ok')+'">'+(r.status||'ERR')+'</span><span class="mono">'+r.timeMs+'ms</span><span class="chip">'+esc(r.src)+'</span>';
    if(!prev)h+='<span class="chg dim">最早记录</span>';
    else if(!ch.length)h+='<span class="chg dim">无参数改动</span>';
    else h+=ch.slice(0,4).map(function(c){return '<span class="chg"><span class="k">'+esc(c.k)+'</span> '+(c.t==='mod'?'<span class="from">'+esc(fmtDiffValue(c.from,20))+'</span>→<span class="to">'+esc(fmtDiffValue(c.to,20))+'</span>':(c.t==='add'?'<span class="to">+'+esc(fmtDiffValue(c.to,20))+'</span>':'<span class="from">-'+esc(fmtDiffValue(c.from,20))+'</span>'))+'</span>';}).join('');
    h+='</div>';
  });
  // 最近两次响应差异
  if(rs.length>=2){
    var ja=null,jb=null;try{ja=JSON.parse(rs[1].respBody);}catch(e){}try{jb=JSON.parse(rs[0].respBody);}catch(e){}
    h+='<div class="sect">最近两次响应差异（'+fmtHM(rs[1].ts)+' → '+fmtHM(rs[0].ts)+'，已滤 signatureServer/traceSign）</div>';
    if(!ja||!jb)h+='<div class="empty dim">响应非 JSON 或快照缺失</div>';
    else{var ds=diffJson(ja,jb);if(!ds.length)h+='<div class="ok">✓ 响应完全一致</div>';else h+='<table class="difftbl"><thead><tr><th>字段</th><th>旧</th><th>新</th></tr></thead><tbody>'+ds.slice(0,80).map(function(d){return '<tr><td>'+esc(d[0])+'</td><td class="del">'+esc(fmtDiffValue(d[1]))+'</td><td class="add">'+esc(fmtDiffValue(d[2]))+'</td></tr>';}).join('')+'</tbody></table>'+(ds.length>80?'<div class="dim" style="font-size:11px">其余 '+(ds.length-80)+' 处略</div>':'');}
  }
  document.getElementById('drBody').innerHTML=h;
  document.getElementById('drawer').classList.add('open');
}
window.closeDrill=function(){document.getElementById('drawer').classList.remove('open');};
initFilters();initNav();render();
</script>
</body></html>`;
}

module.exports = { renderReportHTML, renderReportMarkdown };
