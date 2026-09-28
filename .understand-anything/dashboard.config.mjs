import config from 'C:/Users/shuwe/.understand-anything/repo/understand-anything-plugin/packages/dashboard/vite.config.ts';

export default {
  ...config,
  root: 'C:/Users/shuwe/.understand-anything/repo/understand-anything-plugin/packages/dashboard',
  cacheDir: 'C:/Users/shuwe/CodeProjects/open-source/opencode/.understand-anything/dashboard-cache',
  server: { ...config.server, host: '127.0.0.1', open: false },
};
