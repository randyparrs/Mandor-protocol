@echo off
cd /d "C:\Users\randy\Desktop\mandate-protocol"
"C:\Program Files\nodejs\node.exe" --import tsx scripts\paperVaultCycle.ts >> data\paperVaultCycle.log 2>&1
