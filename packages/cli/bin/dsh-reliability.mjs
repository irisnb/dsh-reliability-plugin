#!/usr/bin/env node
// dsh-reliability — DSH 回答可靠性测试器 CLI 入口
import { main } from "../src/index.mjs";

process.exitCode = await main(process.argv.slice(2));
