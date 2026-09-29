// Local TLS for the site. The edition validation only accepts https links, so `WEB_ORIGIN` is
// https even locally — and a link the local site could not answer would be worse than no link.
// One certificate authority of our own, one certificate for localhost signed by it, both written
// to `certs/` and never committed. The API stays http: it never appears in a built e-mail.
//
// An authority of our own instead of mkcert: openssl is already on every machine, nothing is
// downloaded and nothing asks for a password. The price is that nobody trusts it until told to —
// import `certs/rootCA.pem` in the browser once, or click through the warning every time.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "certs");
const file = (name) => path.join(dir, name);

const CA_DAYS = 3650; // the authority outlives the certificates it signs
const CERT_DAYS = 825; // what browsers accept for a leaf certificate

const openssl = (...args) => execFileSync("openssl", args, { stdio: ["ignore", "pipe", "pipe"] });

// Still good for a month or more: leave it alone, so `pnpm dev` does not rewrite the pair the
// browser was already told to trust.
function stillValid() {
  if (!existsSync(file("localhost.pem")) || !existsSync(file("localhost-key.pem")) || !existsSync(file("rootCA.pem"))) {
    return false;
  }
  try {
    openssl("x509", "-in", file("localhost.pem"), "-noout", "-checkend", String(30 * 24 * 60 * 60));
    return true;
  } catch {
    return false;
  }
}

if (stillValid()) {
  console.log("certs: certificado local ainda válido, nada a fazer");
  process.exit(0);
}

mkdirSync(dir, { recursive: true });

// The names the certificate answers for. Everything the two servers are reached by locally.
const extensions = [
  "basicConstraints = CA:FALSE",
  "keyUsage = critical, digitalSignature, keyEncipherment",
  "extendedKeyUsage = serverAuth",
  "subjectAltName = DNS:localhost, IP:127.0.0.1, IP:::1",
].join("\n");
const extFile = file("localhost.ext");
const csrFile = file("localhost.csr");

try {
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-days", String(CA_DAYS),
    "-subj", "/O=Argon desenvolvimento/CN=Argon local CA",
    "-addext", "basicConstraints = critical, CA:TRUE",
    "-addext", "keyUsage = critical, keyCertSign, cRLSign",
    "-keyout", file("rootCA-key.pem"), "-out", file("rootCA.pem"));

  openssl("req", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-subj", "/O=Argon desenvolvimento/CN=localhost",
    "-keyout", file("localhost-key.pem"), "-out", csrFile);

  writeFileSync(extFile, `${extensions}\n`);
  openssl("x509", "-req", "-sha256", "-days", String(CERT_DAYS),
    "-in", csrFile, "-CA", file("rootCA.pem"), "-CAkey", file("rootCA-key.pem"),
    "-CAcreateserial", "-extfile", extFile, "-out", file("localhost.pem"));
} finally {
  for (const leftover of [csrFile, extFile, file("rootCA.srl")]) rmSync(leftover, { force: true });
}

for (const key of ["rootCA-key.pem", "localhost-key.pem"]) chmodSync(file(key), 0o600);

console.log("certs: certificado local gerado em certs/ (válido por %d dias)", CERT_DAYS);
console.log("certs: para o navegador parar de avisar, importe certs/rootCA.pem como autoridade confiável");
