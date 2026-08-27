/**
 * Canvas styles.
 *
 * Served as a real stylesheet rather than inlined in a template literal, so it
 * is editable as CSS with editor support instead of as an escaped string.
 */
export const STYLES = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--panel:#161b22;--border:#30363d;--raised:#21262d;
  --fg:#e6edf3;--muted:#8b949e;--dim:#6e7681;
  --critical:#f85149;--high:#db6d28;--medium:#d29922;--low:#3fb950;--info:#58a6ff;
}
body{font:13px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
     background:var(--bg);color:var(--fg);height:100vh;overflow:hidden}
.wrap{display:flex;flex-direction:column;height:100vh}

header{padding:12px 16px;border-bottom:1px solid var(--border);
       display:flex;align-items:center;gap:10px;flex-shrink:0}
h1{font-size:14px;font-weight:600;letter-spacing:-.01em}
.badge{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;
       padding:2px 7px;border-radius:99px;border:1px solid}
.badge.live{color:var(--low);border-color:var(--low)}
.badge.sample{color:var(--medium);border-color:var(--medium)}
.spacer{flex:1}
button{background:var(--raised);border:1px solid var(--border);border-radius:6px;
       padding:5px 11px;color:var(--fg);font:inherit;font-size:12px;cursor:pointer;
       transition:background .12s ease,border-color .12s ease}
button:hover{background:#30363d;border-color:#484f58}
button.primary{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:500}
button.primary:hover{background:#388bfd;border-color:#388bfd}
:focus-visible{outline:2px solid var(--info);outline-offset:2px}

.note{padding:7px 16px;font-size:11.5px;color:var(--muted);
      background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0}

.cols{display:grid;grid-template-columns:minmax(280px,38%) 1fr;flex:1;min-height:0}
.queue{border-right:1px solid var(--border);overflow-y:auto}
.detail{overflow-y:auto;padding:16px}

.row{padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer;
     border-left:3px solid transparent;transition:background .1s ease}
.row:hover{background:var(--panel)}
.row.sel{background:var(--panel);border-left-color:var(--info)}
.row-top{display:flex;align-items:center;gap:8px;margin-bottom:3px}
.sev{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
     padding:1px 6px;border-radius:3px;color:#0d1117;flex-shrink:0}
.sev.critical{background:var(--critical)}.sev.high{background:var(--high)}
.sev.medium{background:var(--medium)}.sev.low{background:var(--low)}
.sev.info{background:var(--info)}
.nm{font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;
    text-overflow:ellipsis;flex:1;min-width:0}
.score{font-variant-numeric:tabular-nums;font-size:11px;color:var(--muted);flex-shrink:0}
.meta{font-size:11px;color:var(--dim)}
.bar{height:3px;background:var(--raised);border-radius:2px;margin-top:7px;overflow:hidden}
.bar>i{display:block;height:100%;border-radius:2px;transition:width .3s ease}

h2{font-size:15px;font-weight:600;margin-bottom:3px}
.sub{font-size:11.5px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,monospace;
     margin-bottom:14px;word-break:break-all}
.kv{display:flex;gap:16px;flex-wrap:wrap;padding:10px 12px;background:var(--panel);
    border:1px solid var(--border);border-radius:7px;margin-bottom:16px}
.kv div{font-size:11px}
.kv b{display:block;color:var(--dim);font-weight:500;text-transform:uppercase;
      letter-spacing:.05em;font-size:9.5px;margin-bottom:2px}
h3{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
   margin:16px 0 8px;font-weight:600}
.card{background:var(--panel);border:1px solid var(--border);border-radius:7px;
      padding:11px 13px;margin-bottom:8px}
.card .t{font-weight:600;font-size:12.5px;margin-bottom:4px;display:flex;
         align-items:center;gap:7px;flex-wrap:wrap}
.card .m{color:var(--muted);font-size:11.5px;margin-bottom:5px}
.card .ev{font-family:ui-monospace,SFMono-Regular,monospace;font-size:10.5px;
          color:var(--dim);background:var(--bg);padding:6px 8px;border-radius:4px;
          margin-top:6px;word-break:break-word}
.pill{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;
      padding:1px 6px;border-radius:3px;background:var(--raised);color:var(--muted)}
ul{list-style:none}
li{padding:6px 0 6px 16px;position:relative;font-size:12px;border-bottom:1px solid var(--border)}
li:last-child{border-bottom:0}
li:before{content:"\\2192";position:absolute;left:0;color:var(--info)}
.gap{font-size:11px;color:var(--dim);padding:3px 0}
.empty{padding:40px 20px;text-align:center;color:var(--dim);font-size:12px}
.gate{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:40px 28px;text-align:center;gap:12px}
.gate .icon{width:40px;height:40px;opacity:.5}
.gate h2{font-size:16px;font-weight:600}
.gate p{font-size:13px;color:var(--muted);max-width:420px;line-height:1.6}
.gate .hint{font-size:12px;color:var(--dim);max-width:460px}
.gate code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;
           background:var(--panel);padding:2px 6px;border-radius:4px;color:var(--fg)}
.gate button{padding:8px 20px;font-size:13px;margin-top:4px}
.spin{width:15px;height:15px;border:2px solid var(--border);border-top-color:var(--info);
      border-radius:50%;animation:sp .7s linear infinite;display:inline-block;
      vertical-align:-2px;margin-right:7px}
@keyframes sp{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;
                       transition-duration:.01ms !important}
}
.err{color:var(--critical)}
.actions{display:flex;gap:8px;margin:16px 0 4px}
`;
