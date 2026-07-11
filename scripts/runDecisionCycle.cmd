@echo off
cd /d "C:\Users\randy\Desktop\mandate-protocol"
"C:\Program Files\nodejs\node.exe" --import tsx scripts\runDecisionCycle.ts >> data\decisionCycle.log 2>&1
