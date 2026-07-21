@echo off
cd /d "C:\Users\randy\Desktop\mandate-protocol"
"C:\Program Files\nodejs\node.exe" --import tsx scripts\runDecisionCycleV4.ts >> data\decisionCycleV4.log 2>&1
