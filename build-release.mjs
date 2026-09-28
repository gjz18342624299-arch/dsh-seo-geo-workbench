import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const out=resolve(root,'../../outputs/SEO-GEO-Windows-preview-'+Date.now());
await mkdir(join(out,'payload'),{recursive:true});
// Allowlist: no deployment.json, state, reports, screenshots, keys or developer backups.
for(const file of ['index.js','core.js','analysis.js','entity-judge.js','store.js','seo-reports.js','seo-jobs.js','seo-report-reader.js','data-root.js','syncers.js','collector.js','chrome-bridge.js','server.js','client.js','package.json','cordis.patch.yml','question-jobs.js'])await cp(join(root,file),join(out,'payload',file));
await cp(join(root,'chrome-extension'),join(out,'payload/chrome-extension'),{recursive:true});
await mkdir(join(out,'payload/vendor/node_modules'),{recursive:true});
for(const dep of ['xlsx','playwright-core'])await cp(join(root,'vendor/node_modules',dep),join(out,'payload/vendor/node_modules',dep),{recursive:true});
for(const file of ['install-portable.mjs','Install.cmd','Install.ps1'])await cp(join(root,file),join(out,file));
// Windows PowerShell 5 reads a UTF-8 BOM when the script contains Chinese.
await writeFile(join(out,'Install.ps1'),'\uFEFF'+await readFile(join(root,'Install.ps1'),'utf8'));
await writeFile(join(out,'使用说明.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>SEO/GEO 监测工作台 · 安装指南</title><style>body{font:16px/1.8 system-ui;max-width:820px;margin:48px auto;padding:0 24px;color:#20282c}h1{font-size:28px}code{background:#eef3f1;padding:3px 6px}li{margin:12px 0}</style><h1>SEO/GEO 监测工作台</h1><p>by DataElem · Windows 安装预览版</p><h2>安装工作台</h2><ol><li>先安装并启动一次 DSH Desktop，完成初始化，然后正常退出。无需额外安装 Node。</li><li>将整个 ZIP 解压到一个文件夹。双击 <code>Install.cmd</code>。未自动找到 DSH 时，在窗口中选择 <code>DSH Desktop.exe</code>。</li><li>出现“安装完成”后重新打开 DSH，点击“SEO GEO 工作台”。下载目录可以移走：工作台已复制到你的 DSH 用户目录。</li></ol><h2>安装随包提供的浏览器扩展</h2><ol><li>在工作台“浏览器与使用指南”选择浏览器，点击“获取扩展目录和连接码”。这里显示的是你自己电脑上的目录。</li><li>Chrome 打开 <code>chrome://extensions</code>；Edge 打开 <code>edge://extensions</code>。打开开发者模式，选择“加载已解压的扩展程序”，粘贴工作台显示的扩展目录。无需另行下载扩展。</li><li>打开扩展图标，将工作台显示的本机连接码粘贴进去并连接。</li><li>回到工作台检查连接，登录目标 AI 平台并先做一题自检。Firefox/Safari 暂用文件导入；Edge/Brave 尚需实机兼容验收。</li></ol><h2>第一次监测</h2><p>先在“品牌与数据源”改成自己的品牌。当前包含 DSH 示例规则，通用品牌判定仍需人工核对。配置 DSH 模型后，填写需求 → 生成或编辑问题 → 创建采集任务 → 开始采集 → 核对证据 → 生成报告。报告追问才使用右侧对话。</p><h2>升级与恢复</h2><p>再次安装前退出 DSH。安装器保存旧工作台和 profile 配置到 DSH profile 下的 <code>seo-geo-install-backups</code>，保留已有数据位置。安装报错会尝试自动回滚；如因文件占用恢复失败，请保留错误和备份。不要删除业务数据目录。</p><h2>预览版边界</h2><p>本包尚未通过另一台全新 Windows 电脑的完整桌面验收，也未签名；不要视作正式公开发行。项目许可证仍为 UNLICENSED，未擅自授予开源许可。第三方依赖的许可文件保留在各自目录中。扩展需要用户手动加载和授权，安装器不会操作浏览器安全设置。</p></html>`);
console.log(out);
