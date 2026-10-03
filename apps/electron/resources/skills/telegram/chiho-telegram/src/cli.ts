#!/usr/bin/env node

import { loadEnvironment } from './app/environment.js';
import { runCliMain } from './core/cli-runner.js';

loadEnvironment();
void runCliMain(process.argv.slice(2));
