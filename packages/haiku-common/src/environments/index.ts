/**
 * Runtime environment.
 * @enum {string}
 */
export const enum Environment {
  Test = 'test',
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
}

/**
 * Runtime environment type.
 * @enum {string}
 */
export const enum EnvironmentType {
  Development = 'development',
  Release = 'release',
}

/**
 * Canonical method to retrieve the current environment.
 *
 * If no environment is provided as an environment variable, assume production.
 */
export const getEnvironment = () => global.process.env.NODE_ENV || Environment.Production;

/**
 * Gets the environment type.
 */
export const getEnvironmentType = () => {
  const environment = getEnvironment();
  return (environment === Environment.Staging || environment === Environment.Production)
    ? EnvironmentType.Release
    : EnvironmentType.Development;
};
