const fs = require('node:fs');
const path = require('node:path');

const YAML = require('yaml');

function readYamlFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const text = fs.readFileSync(absolutePath, 'utf8');
  const document = YAML.parse(text);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`YAML document must be an object: ${absolutePath}`);
  }
  return {
    absolutePath,
    text,
    document,
  };
}

function writeYamlFile(filePath, payload) {
  const absolutePath = path.resolve(filePath);
  const text = YAML.stringify(payload, {
    lineWidth: 0,
    minContentWidth: 0,
  });
  fs.writeFileSync(absolutePath, text, 'utf8');
  return absolutePath;
}

module.exports = {
  readYamlFile,
  writeYamlFile,
};
