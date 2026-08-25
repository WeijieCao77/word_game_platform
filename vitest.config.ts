import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // 用进程池而不是默认的线程池。
    //
    // 模板体检那几条要跑 600 局模拟，是纯 CPU 的长任务，会把线程堵住几十秒；
    // 线程池里 worker 与主线程共享事件循环，心跳回不去，vitest 就抛
    // 「[vitest-worker]: Timeout calling "onTaskUpdate"」——用例全绿，进程却退 1，
    // CI 因此一直判失败。换成 forks，每个 worker 是独立进程，堵住的是它自己。
    pool: "forks",
    // 关键：给主进程留出核。worker 与主进程之间的心跳（onTaskUpdate）
    // 硬编码 60 秒超时，改不了；worker 数一旦顶满核数，主进程被 CPU 饿着，
    // 心跳答不上来，vitest 就报一条 unhandled error——用例全绿，进程照样退 1。
    // CI runner 两核，这里留一半。
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    testTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
