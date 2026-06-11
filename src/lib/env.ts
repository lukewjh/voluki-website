export const getEnv = (locals: unknown, key: string) => {
  const runtimeEnv = (locals as any).runtime?.env?.[key];
  const buildEnv = import.meta.env[key];

  return runtimeEnv ?? buildEnv;
};
