import { GetParametersByPathCommand, type Parameter, SSMClient } from "@aws-sdk/client-ssm";

// What the API reads from the environment, in AWS, comes from the Parameter Store: there is no
// deploy step on the machine to write it anywhere, so the function reads /argon/<env>/ itself
// before the app is loaded. Same names as the variables the app reads (src/config.ts).

type Fetch = (path: string, nextToken?: string) => Promise<{ Parameters?: Parameter[]; NextToken?: string }>;

// One page at a time until the path runs out: GetParametersByPath returns ten per call.
export async function parametersUnder(path: string, fetch: Fetch): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  let nextToken: string | undefined;
  do {
    const page = await fetch(path, nextToken);
    for (const { Name, Value } of page.Parameters ?? []) {
      if (Name && Value !== undefined) values[Name.slice(Name.lastIndexOf("/") + 1)] = Value;
    }
    nextToken = page.NextToken;
  } while (nextToken);
  return values;
}

// The function's own variables win over the store: they are what sets the two functions of one
// environment apart from each other and from a development machine (no internal clock, no
// Studio, the jobs route on the jobs function only; deploy/aws/lambda.tf).
export function fillEnv(env: NodeJS.ProcessEnv, values: Record<string, string>): string[] {
  const filled: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (env[name] !== undefined) continue;
    env[name] = value;
    filled.push(name);
  }
  return filled;
}

export async function loadParameters(path: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const ssm = new SSMClient({});
  const values = await parametersUnder(path, (Path, NextToken) =>
    ssm.send(new GetParametersByPathCommand({ Path, NextToken, WithDecryption: true })),
  );
  return fillEnv(env, values);
}
