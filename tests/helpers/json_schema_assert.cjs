const assert = require('node:assert/strict');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSchemaNode(rootSchema, schema) {
  if (!schema || typeof schema !== 'object') {
    throw new Error('Invalid schema node');
  }

  if (schema.$ref) {
    const ref = String(schema.$ref);
    if (!ref.startsWith('#/')) {
      throw new Error(`Unsupported schema ref: ${ref}`);
    }
    return ref
      .slice(2)
      .split('/')
      .reduce((node, segment) => {
        if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, segment)) {
          throw new Error(`Unresolvable schema ref: ${ref}`);
        }
        return node[segment];
      }, rootSchema);
  }

  return schema;
}

function matchesType(type, value) {
  switch (type) {
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateSchema(rootSchema, schema, value, path = 'root') {
  const node = readSchemaNode(rootSchema, schema);

  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    assert.deepEqual(value, node.const, `${path} must equal const ${JSON.stringify(node.const)}`);
  }

  if (Array.isArray(node.enum)) {
    assert.ok(node.enum.some((candidate) => Object.is(candidate, value)), `${path} must be one of ${JSON.stringify(node.enum)}`);
  }

  if (Array.isArray(node.allOf)) {
    for (const child of node.allOf) {
      validateSchema(rootSchema, child, value, path);
    }
  }

  if (Array.isArray(node.oneOf)) {
    const successes = [];
    const errors = [];
    for (const child of node.oneOf) {
      try {
        validateSchema(rootSchema, child, value, path);
        successes.push(child);
      } catch (error) {
        errors.push(error);
      }
    }
    assert.equal(
      successes.length,
      1,
      `${path} must satisfy exactly one oneOf branch (${successes.length} matched): ${errors.map((error) => error.message).join(' | ')}`,
    );
  }

  if (node.type !== undefined) {
    const allowedTypes = Array.isArray(node.type) ? node.type : [node.type];
    assert.ok(
      allowedTypes.some((type) => matchesType(type, value)),
      `${path} must match type ${JSON.stringify(allowedTypes)}, received ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}`,
    );
  }

  if (typeof node.minimum === 'number' && typeof value === 'number') {
    assert.ok(value >= node.minimum, `${path} must be >= ${node.minimum}`);
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(node.properties) ? node.properties : {};
    const required = Array.isArray(node.required) ? node.required : [];

    for (const key of required) {
      assert.ok(Object.prototype.hasOwnProperty.call(value, key), `${path}.${key} is required`);
    }

    for (const [key, childValue] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        validateSchema(rootSchema, properties[key], childValue, `${path}.${key}`);
        continue;
      }

      if (node.additionalProperties === false) {
        assert.fail(`${path}.${key} is not allowed by schema`);
      }

      if (isPlainObject(node.additionalProperties)) {
        validateSchema(rootSchema, node.additionalProperties, childValue, `${path}.${key}`);
      }
    }
  }

  if (Array.isArray(value) && node.items) {
    value.forEach((item, index) => {
      validateSchema(rootSchema, node.items, item, `${path}[${index}]`);
    });
  }
}

function assertSchemaValid(rootSchema, schema, value, label = 'payload') {
  validateSchema(rootSchema, schema, value, label);
}

module.exports = {
  assertSchemaValid,
};
