import { parentPort, workerData } from 'node:worker_threads';
import { generateTimetables } from './engine.js';
parentPort!.postMessage(generateTimetables(workerData));
