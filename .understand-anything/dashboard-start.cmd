@echo off
set "GRAPH_DIR=C:\Users\shuwe\CodeProjects\open-source\opencode"
cd /d "C:\Users\shuwe\.understand-anything\repo\understand-anything-plugin\packages\dashboard"
"C:\Users\shuwe\.understand-anything\repo\understand-anything-plugin\packages\dashboard\node_modules\.bin\vite.cmd" --host 127.0.0.1 > "C:\Users\shuwe\CodeProjects\open-source\opencode\.understand-anything\dashboard-out.log" 2> "C:\Users\shuwe\CodeProjects\open-source\opencode\.understand-anything\dashboard-err.log"
