import { GetParametersByPathCommand, type Parameter, SSMClient } from "@aws-sdk/client-ssm";

// What the API reads from the environment, in AWS, comes from the Parameter Store: on the EC2,
// deploy.sh writes it to an env file; on Lambda there is no deploy step on the machine, so the
// function reads /argon/<env>/ itself before the app is loaded. Same names, same values.

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

// The function's own variables win over the store: they are what makes a Lambda different from
// the EC2 container of the same environment (no internal clock, no Studio, the jobs route on).
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
