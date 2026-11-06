@echo off
cd /d %~dp0
if not exist node_modules call npm install
if not exist .env copy .env.example .env
echo Edit .env (admin login, payment details, Firecrawl key) then run this file again.
node server.js
pause
