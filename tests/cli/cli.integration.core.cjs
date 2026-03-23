const shared = require('./cli.integration.shared.cjs');
const { test, assert, crypto, fs, os, path, DOCTOR_ENV_KEYS, createTempDir, removeDir, runCli, runCliAsync, runCliWithTty, startJsonHttpServer, assertSchemaValid, omitGeneratedAt, omitTrustDistributionFromCapabilities, omitTrustDistributionDefinitions, assertManifestParity, createIsolatedPandoraEnv, createMcpToolRegistry, COMMAND_DESCRIPTOR_VERSION, buildCommandDescriptors, createRunMirrorCommand, buildSchemaPayload, buildSetupPlan, createOperationService, upsertOperation, createOperationStateStore, buildSdkContractArtifact, SDK_ARTIFACT_GENERATED_AT, buildPublishedPackageJson, repoPackage, generatedManifest, generatedContractRegistry, latestBenchmarkReport, typescriptSdkPackage, publishedPackage, setupWizardModulePath, setupRuntimeReady, setupTest, testInteractiveSetup, TEST_CLI_PATH, ADDRESSES, POLYMARKET_DEFAULTS, writeFile, parseJsonOutput, delay, isPidAlive, waitForPidExit, parseNdjsonOutput, stableJsonHash, deepCloneJson, parseTomlStringField, buildValidEnv, buildRules, buildMockHypeResponse, FIXED_FUTURE_TIMESTAMP, FIXED_MIRROR_CLOSE_ISO, FIXED_MIRROR_CLOSE_TS, buildMirrorIndexerOverrides, buildMirrorPolymarketOverrides, buildMirrorSportsPolymarketOverrides, buildLaunchArgs, buildCloneArgs, encodeUint256, encodeBool, decodeAddressFromCallData, startRpcMockServer, startPolymarketOpsRpcMock, encodeAddress, encodeString, encodeHexQuantity, startFeesWithdrawRpcMock, startMirrorTraceRpcMock, applyWhereFilter, applyListControls, asPage, resolveBatchEntitySelections, startIndexerMockServer, assertOddsShape, assertIsoTimestamp, startPhaseOneIndexerMockServer, startLifecycleIndexerMockServer, startAnalyzeIndexerMockServer, startPolymarketMockServer } = shared;

test('help prints usage with zero exit code', () => {
  const result = runCli([]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora - Prediction market CLI/);
  assert.match(result.output, /Usage:/);
  assert.match(result.output, /pandora \[--output table\|json\] markets mine/);
  assert.match(result.output, /pandora \[--output table\|json\] fees/);
  assert.match(result.output, /pandora \[--output table\|json\] debug market\|tx/);
  assert.match(result.output, /mirror browse\|plan\|deploy\|verify\|lp-explain\|hedge-calc\|calc\|simulate\|go\|sync\|hedge\|trace\|dashboard\|status\|health\|panic\|drift\|hedge-check\|pnl\|audit\|replay\|logs\|close/);
});

test('help accepts optional leading pandora token for npx compatibility', () => {
  const result = runCli(['pandora', '--help']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.output, /pandora - Prediction market CLI/);
  assert.match(result.output, /Usage:/);
});

test('global --output json returns structured error envelope', () => {
  const result = runCli(['--output', 'json', 'not-a-command']);
  assert.equal(result.status, 1);

  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
});

test('json error envelopes are emitted on stdout (not stderr)', () => {
  const result = runCli(['--output', 'json', 'not-a-command']);
  assert.equal(result.status, 1);
  assert.equal(String(result.stderr || '').trim(), '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
});

test('invalid --output mode returns json error envelope', () => {
  const result = runCli(['--output', 'xml', 'help']);
  assert.equal(result.status, 1);
  assert.equal(String(result.stderr || '').trim(), '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_OUTPUT_MODE');
});

test('missing --output value returns json error envelope', () => {
  const result = runCli(['--output']);
  assert.equal(result.status, 1);
  assert.equal(String(result.stderr || '').trim(), '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'MISSING_FLAG_VALUE');
});

test('private key parse errors redact the provided key value', () => {
  const badPrivateKey = '0x1234';
  const result = runCli(['--output', 'json', 'mirror', 'deploy', '--private-key', badPrivateKey]);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_FLAG_VALUE');
  assert.match(payload.error.message, /\[redacted\]/);
  assert.ok(!payload.error.message.includes(badPrivateKey));
});

test('unknown command prints help hint in table mode', () => {
  const result = runCli(['not-a-command']);
  assert.equal(result.status, 1);
  assert.match(result.output, /\[UNKNOWN_COMMAND\]/);
  assert.match(result.output, /Unknown command: not-a-command/);
  assert.match(result.output, /Run `pandora help` to see available commands\./);
});

test('schema command requires --output json mode', () => {
  const result = runCli(['schema']);
  assert.equal(result.status, 1);
  assert.match(result.output, /\[INVALID_USAGE\]/);
  assert.match(result.output, /only supported in --output json mode/i);
});

test('schema --help succeeds in table mode', () => {
  const result = runCli(['schema', '--help']);
  assert.equal(result.status, 0);
  assert.match(String(result.stdout || ''), /Usage:\s+pandora --output json schema/);
});

test('schema command returns envelope schema plus command descriptors', () => {
  const result = runCli(['--output', 'json', 'schema']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'schema');

  assert.equal(payload.data.title, 'PandoraCliEnvelope');
  assert.ok(String(payload.data.$schema).includes('json-schema.org'));
  assert.ok(payload.data.definitions && payload.data.definitions.SuccessEnvelope);
  assert.ok(payload.data.definitions && payload.data.definitions.ErrorEnvelope);

  assert.equal(payload.data.commandDescriptorVersion, COMMAND_DESCRIPTOR_VERSION);
  assert.ok(payload.data.commandDescriptors);
  assert.ok(payload.data.commandDescriptors.quote);
  assert.equal(payload.data.commandDescriptors.quote.dataSchema, '#/definitions/QuotePayload');
  assert.ok(payload.data.commandDescriptors.quote.emits.includes('quote'));
  assert.ok(payload.data.commandDescriptors.scan);
  assert.equal(payload.data.commandDescriptors.scan.dataSchema, '#/definitions/PagedEntityPayload');
  assert.ok(payload.data.commandDescriptors.stream);
  assert.equal(payload.data.commandDescriptors.stream.dataSchema, '#/definitions/StreamTickPayload');
  assert.equal(payload.data.commandDescriptors['markets.scan'], undefined);
  assert.ok(payload.data.commandDescriptors.trade);
  assert.equal(payload.data.commandDescriptors.trade.dataSchema, '#/definitions/TradePayload');
  assert.ok(payload.data.commandDescriptors.sell);
  assert.equal(payload.data.commandDescriptors.sell.dataSchema, '#/definitions/TradePayload');
  assert.ok(payload.data.commandDescriptors['mirror.browse']);
  assert.equal(payload.data.commandDescriptors['mirror.browse'].dataSchema, '#/definitions/MirrorBrowsePayload');
  assert.match(payload.data.commandDescriptors['mirror.browse'].usage, /--polymarket-tag-id/);
  assert.ok(payload.data.commandDescriptors['mirror.plan']);
  assert.equal(payload.data.commandDescriptors['mirror.plan'].dataSchema, '#/definitions/MirrorPlanPayload');
  assert.ok(payload.data.commandDescriptors['risk.show']);
  assert.equal(payload.data.commandDescriptors['risk.show'].dataSchema, '#/definitions/RiskPayload');
  assert.ok(payload.data.commandDescriptors['risk.panic']);
  assert.equal(payload.data.commandDescriptors['risk.panic'].dataSchema, '#/definitions/RiskPayload');
  assert.ok(payload.data.commandDescriptors.lifecycle);
  assert.equal(payload.data.commandDescriptors.lifecycle.dataSchema, '#/definitions/LifecyclePayload');
  assert.ok(payload.data.commandDescriptors['odds.record']);
  assert.equal(payload.data.commandDescriptors['odds.record'].dataSchema, '#/definitions/OddsRecordPayload');
  assert.ok(payload.data.commandDescriptors['odds.history']);
  assert.equal(payload.data.commandDescriptors['odds.history'].dataSchema, '#/definitions/OddsHistoryPayload');
  assert.ok(payload.data.commandDescriptors.portfolio);
  assert.equal(payload.data.commandDescriptors.portfolio.dataSchema, '#/definitions/PortfolioPayload');
  assert.ok(payload.data.commandDescriptors.export);
  assert.equal(payload.data.commandDescriptors.export.dataSchema, '#/definitions/ExportPayload');
  assert.ok(payload.data.commandDescriptors['arb.scan']);
  assert.equal(payload.data.commandDescriptors['arb.scan'].dataSchema, '#/definitions/ArbScanPayload');
  assert.match(payload.data.commandDescriptors['arb.scan'].usage, /--combinatorial/);
  assert.match(payload.data.commandDescriptors['arb.scan'].usage, /--slippage-pct-per-leg/);
  assert.ok(payload.data.commandDescriptors['simulate.mc']);
  assert.equal(payload.data.commandDescriptors['simulate.mc'].dataSchema, '#/definitions/SimulateMcPayload');
  assert.ok(payload.data.commandDescriptors['simulate.particle-filter']);
  assert.equal(
    payload.data.commandDescriptors['simulate.particle-filter'].dataSchema,
    '#/definitions/SimulateParticleFilterPayload',
  );
  assert.ok(payload.data.commandDescriptors['simulate.agents']);
  assert.equal(payload.data.commandDescriptors['simulate.agents'].dataSchema, '#/definitions/SimulateAgentsPayload');
  assert.ok(payload.data.commandDescriptors['model.score.brier']);
  assert.equal(payload.data.commandDescriptors['model.score.brier'].dataSchema, '#/definitions/ModelScoreBrierPayload');
  assert.ok(payload.data.commandDescriptors['model.calibrate']);
  assert.equal(payload.data.commandDescriptors['model.calibrate'].dataSchema, '#/definitions/ModelCalibratePayload');
  assert.ok(payload.data.commandDescriptors['model.correlation']);
  assert.equal(payload.data.commandDescriptors['model.correlation'].dataSchema, '#/definitions/ModelCorrelationPayload');
  assert.ok(payload.data.commandDescriptors['model.diagnose']);
  assert.equal(payload.data.commandDescriptors['model.diagnose'].dataSchema, '#/definitions/ModelDiagnosePayload');
  assert.ok(payload.data.commandDescriptors.schema);
  assert.deepEqual(payload.data.commandDescriptors.schema.outputModes, ['json']);
  assert.ok(payload.data.commandDescriptors.mcp);
  assert.deepEqual(payload.data.commandDescriptors.mcp.outputModes, ['table']);
  assert.ok(payload.data.commandDescriptors.launch);
  assert.deepEqual(payload.data.commandDescriptors.launch.outputModes, ['table']);
  assert.ok(payload.data.commandDescriptors['clone-bet']);
  assert.deepEqual(payload.data.commandDescriptors['clone-bet'].outputModes, ['table']);
  assert.equal(payload.data.descriptorScope, 'canonical-command-surface');
  assert.equal(payload.data.commandDescriptorMetadata.capabilities.supportsRemote, true);
  assert.equal(payload.data.trustDistribution.posture, 'repo-release-gates-and-published-surface-observed');
  assert.equal(payload.data.trustDistribution.distribution.rootPackage.name, repoPackage.name);
  assert.equal(
    payload.data.trustDistribution.distribution.generatedContractArtifacts.artifactVersion,
    generatedManifest.artifactVersion,
  );
  assert.equal(
    payload.data.trustDistribution.distribution.embeddedSdks.typescript.packageName,
    typescriptSdkPackage.name,
  );
  assert.equal(payload.data.trustDistribution.verification.benchmark.lockPath, 'benchmarks/locks/core.lock.json');
  assert.equal(payload.data.trustDistribution.verification.benchmark.lockPresent, true);
  assert.equal(payload.data.trustDistribution.verification.benchmark.reportPath, 'benchmarks/latest/core-report.json');
  assert.equal(payload.data.trustDistribution.verification.benchmark.reportPresent, true);
  assert.equal(
    payload.data.trustDistribution.verification.benchmark.reportOverallPass,
    latestBenchmarkReport.summary.overallPass,
  );
  assert.equal(
    payload.data.trustDistribution.verification.benchmark.reportContractLockMatchesExpected,
    latestBenchmarkReport.contractLockMatchesExpected,
  );
  assert.equal(payload.data.trustDistribution.distribution.platformValidation.ci.workflowPath, '.github/workflows/ci.yml');
  assert.deepEqual(payload.data.trustDistribution.distribution.platformValidation.ci.osMatrix, ['macos-latest', 'ubuntu-latest', 'windows-latest']);
  assert.deepEqual(payload.data.trustDistribution.distribution.platformValidation.ci.nodeVersions, ['20']);
  assert.equal(payload.data.trustDistribution.verification.ciWorkflow.path, '.github/workflows/ci.yml');
  assert.equal(payload.data.trustDistribution.verification.ciWorkflow.present, false);
  assert.ok(payload.data.trustDistribution.verification.releaseAssets.names.includes('checksums.sha256'));
  assert.ok(payload.data.trustDistribution.verification.releaseAssets.verificationMethods.includes('keyless-cosign-verify-blob'));
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsTrustDocs, true);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsReleaseTrustScripts, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsBenchmarkHarness, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsBenchmarkReport, true);
  assert.equal(payload.data.trustDistribution.verification.scripts.build, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.prepack, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.checkReleaseTrust, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.generateSbom, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.releasePrep, null);
  assert.equal(payload.data.trustDistribution.verification.signals.buildRunsReleaseTrustCheck, false);
  assert.equal(payload.data.trustDistribution.verification.signals.prepackRunsReleaseTrustCheck, false);
  assert.equal(payload.data.trustDistribution.verification.signals.trustDocsPresent, true);
  assert.equal(payload.data.trustDistribution.verification.signals.releasePrepRunsSbom, false);
  assert.equal(payload.data.trustDistribution.verification.signals.releasePrepRunsTrustCheck, false);
  assert.equal(payload.data.trustDistribution.verification.signals.testRunsBenchmarkCheck, false);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.workflowRunsNpmTest, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.workflowRunsReleasePrep, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.repoTestRunsSmoke, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.repoReleasePrepRunsSmoke, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.publishedReleasePrepRunsSmoke, false);
  assert.ok(
    payload.data.commandDescriptorMetadata.counts.supportsRemote >= Object.keys(payload.data.commandDescriptors).length,
  );
  assert.ok(payload.data.documentation.skills.some((doc) => doc.path === 'docs/trust/release-verification.md'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.path === 'docs/trust/security-model.md'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.path === 'docs/trust/support-matrix.md'));
  assert.ok(payload.data.definitions.TrustDistributionPayload);
  assert.ok(payload.data.definitions.QuotePayload);
  assert.ok(payload.data.definitions.TradePayload);
  assert.ok(payload.data.definitions.MirrorPlanPayload);
  assert.ok(payload.data.definitions.RiskPayload);
  assert.ok(payload.data.definitions.LifecyclePayload);
  assert.ok(payload.data.definitions.OddsRecordPayload);
  assert.ok(payload.data.definitions.OddsHistoryPayload);
  assert.ok(payload.data.definitions.PortfolioPayload);
  assert.ok(payload.data.definitions.ExportPayload);
  assert.ok(payload.data.definitions.ArbScanPayload);
  assert.ok(payload.data.definitions.SimulateMcPayload);
  assert.ok(payload.data.definitions.SimulateParticleFilterPayload);
  assert.ok(payload.data.definitions.SimulateAgentsPayload);
  assert.ok(payload.data.definitions.ModelScoreBrierPayload);
  assert.ok(payload.data.definitions.ModelCalibratePayload);
  assert.ok(payload.data.definitions.ModelCorrelationPayload);
  assert.ok(payload.data.definitions.ModelDiagnosePayload);
  assert.ok(payload.data.definitions.ErrorRecoveryPayload);
  assert.ok(payload.data.definitions.MirrorBrowsePayload);
  assert.ok(payload.data.definitions.VersionPayload);
  assert.ok(payload.data.definitions.InitEnvPayload);
  assert.ok(payload.data.definitions.DoctorPayload);
  assert.ok(payload.data.definitions.SetupPayload);
  assert.ok(payload.data.definitions.DoctorPayload.properties.goal);
  assert.ok(payload.data.definitions.DoctorPayload.properties.runtimeInfo);
  assert.ok(payload.data.definitions.DoctorPayload.properties.report);
  assert.ok(payload.data.definitions.DoctorPayload.properties.checks);
  assert.ok(payload.data.definitions.DoctorPayload.properties.journeyReadiness);
  assert.ok(payload.data.definitions.DoctorPayload.properties.recommendedCommands);
  assert.ok(payload.data.definitions.SetupPayload.properties.action);
  assert.ok(payload.data.definitions.SetupPayload.properties.mode);
  assert.ok(payload.data.definitions.SetupPayload.properties.goal);
  assert.ok(payload.data.definitions.SetupPayload.properties.runtimeInfo);
  assert.ok(payload.data.definitions.SetupPayload.properties.envFile);
  assert.ok(payload.data.definitions.SetupPayload.properties.envChanges);
  assert.ok(payload.data.definitions.SetupPayload.properties.envStep);
  assert.ok(payload.data.definitions.SetupPayload.properties.plan);
  assert.ok(payload.data.definitions.SetupPayload.properties.wizard);
  assert.ok(payload.data.definitions.SetupPayload.properties.plan);
  assert.ok(payload.data.definitions.SetupPayload.properties.doctor);
  assert.ok(payload.data.definitions.SetupPayload.properties.readiness);
  assert.ok(payload.data.definitions.SetupPayload.properties.guidedNextSteps);
  assert.ok(payload.data.definitions.SetupPayload.properties.diagnostics);
  assert.ok(payload.data.definitions.SetupPayload.properties.warnings);
  assert.ok(payload.data.definitions.HistoryPayload);
  assert.ok(payload.data.definitions.ArbitragePayload);
  assert.ok(payload.data.definitions.PolymarketPayload);
  assert.ok(payload.data.definitions.WebhookPayload);
  assert.ok(payload.data.definitions.AnalyzePayload);
  assert.ok(payload.data.definitions.SuggestPayload);
  assert.ok(payload.data.definitions.OddsHelpPayload);
  assert.ok(payload.data.definitions.MirrorStatusHelpPayload);
  assert.ok(payload.data.definitions.OperationReceiptPayload);
  assert.ok(payload.data.definitions.OperationReceiptVerificationPayload);
});

test('schema command can include compatibility descriptors explicitly', () => {
  const result = runCli(['--output', 'json', 'schema', '--include-compatibility']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'schema');
  assert.equal(payload.data.descriptorScope, 'command-surface+compatibility');
  assert.ok(payload.data.commandDescriptors['markets.scan']);
  assert.equal(payload.data.commandDescriptors['markets.scan'].canonicalTool, 'scan');
  assert.equal(payload.data.commandDescriptors['markets.scan'].aliasOf, 'scan');
  assert.ok(payload.data.commandDescriptors.arbitrage);
  assert.equal(payload.data.commandDescriptors.arbitrage.canonicalTool, 'arb.scan');
  assert.equal(payload.data.commandDescriptors.arbitrage.aliasOf, 'arb.scan');
});

test('schema command covers every MCP tool and exposes canonical metadata', () => {
  const result = runCli(['--output', 'json', 'schema', '--include-compatibility']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  const descriptors = payload.data.commandDescriptors;
  const registry = createMcpToolRegistry();
  const defaultTools = registry.listTools();
  const allTools = registry.listTools({ includeCompatibilityAliases: true });
  const defaultToolNames = new Set(defaultTools.map((tool) => tool.name));
  const allToolNames = new Set(allTools.map((tool) => tool.name));

  for (const tool of allTools) {
    const descriptor = descriptors[tool.name];
    assert.ok(descriptor, `missing schema descriptor for MCP tool ${tool.name}`);
    assert.equal(descriptor.mcpExposed, true, `expected ${tool.name} to be MCP-exposed`);
    assert.equal(descriptor.canonicalTool, tool.xPandora.canonicalTool, `canonicalTool mismatch for ${tool.name}`);
    assert.equal(descriptor.aliasOf, tool.xPandora.aliasOf, `aliasOf mismatch for ${tool.name}`);
    assert.equal(descriptor.preferred, tool.xPandora.preferred, `preferred mismatch for ${tool.name}`);
    assert.equal(descriptor.mcpMutating, tool.xPandora.mutating, `mutating mismatch for ${tool.name}`);
    assert.equal(descriptor.mcpLongRunningBlocked, tool.xPandora.longRunningBlocked, `longRunning mismatch for ${tool.name}`);
    assert.deepEqual(
      descriptor.controlInputNames,
      tool.xPandora.controlInputNames,
      `controlInputNames mismatch for ${tool.name}`,
    );
    assert.deepEqual(
      descriptor.agentWorkflow,
      tool.xPandora.agentWorkflow,
      `agentWorkflow mismatch for ${tool.name}`,
    );
    assert.equal(typeof descriptor.inputSchema, 'object', `missing inputSchema for ${tool.name}`);
  }

  for (const [commandName, descriptor] of Object.entries(descriptors)) {
    if (descriptor.mcpExposed) {
      if (descriptor.aliasOf) {
        assert.ok(
          allToolNames.has(commandName),
          `schema marks ${commandName} as MCP-exposed alias but MCP tools/list(includeCompatibilityAliases) is missing it`,
        );
        assert.ok(
          !defaultToolNames.has(commandName),
          `compatibility alias ${commandName} should not appear in default MCP tools/list`,
        );
      } else {
        assert.ok(
          defaultToolNames.has(commandName),
          `schema marks ${commandName} as MCP-exposed canonical tool but default MCP tools/list is missing it`,
        );
      }
    }
  }

  assert.ok(descriptors['events.list']);
  assert.ok(descriptors['events.get']);
  assert.ok(descriptors['positions.list']);
  assert.ok(descriptors.history);
  assert.ok(descriptors.arbitrage);
  assert.ok(descriptors['polymarket.trade']);
  assert.ok(descriptors['webhook.test']);
  assert.ok(descriptors.launch);
  assert.ok(descriptors['clone-bet']);
  assert.equal(descriptors.arbitrage.aliasOf, 'arb.scan');
  assert.equal(descriptors.arbitrage.canonicalTool, 'arb.scan');
  assert.equal(descriptors.arbitrage.preferred, false);
  assert.equal(descriptors['arb.scan'].canonicalTool, 'arb.scan');
  assert.equal(descriptors['arb.scan'].preferred, true);
});

test('schema command preserves normalized MCP metadata defaults for primary and alias tools', () => {
  const result = runCli(['--output', 'json', 'schema', '--include-compatibility']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  const descriptors = payload.data.commandDescriptors;

  assert.equal(descriptors.help.canonicalTool, 'help');
  assert.equal(descriptors.help.aliasOf, null);
  assert.equal(descriptors.help.preferred, true);
  assert.equal(descriptors.help.mcpExposed, true);
  assert.equal(descriptors.help.mcpMutating, false);
  assert.equal(descriptors.help.mcpLongRunningBlocked, false);
  assert.deepEqual(descriptors.help.controlInputNames, []);
  assert.equal(descriptors.help.agentWorkflow, null);

  assert.equal(descriptors.arbitrage.canonicalTool, 'arb.scan');
  assert.equal(descriptors.arbitrage.aliasOf, 'arb.scan');
  assert.equal(descriptors.arbitrage.preferred, false);
  assert.equal(descriptors.arbitrage.mcpExposed, true);
  assert.equal(descriptors.arbitrage.mcpMutating, false);
  assert.equal(descriptors.arbitrage.mcpLongRunningBlocked, false);
  assert.deepEqual(descriptors.arbitrage.controlInputNames, []);
  assert.equal(descriptors.arbitrage.agentWorkflow, null);
});

test('schema help definitions match representative emitted help payloads', () => {
  const schemaResult = runCli(['--output', 'json', 'schema']);
  assert.equal(schemaResult.status, 0);
  const schemaPayload = parseJsonOutput(schemaResult);
  const schemaDocument = schemaPayload.data;
  const descriptors = schemaPayload.data.commandDescriptors;

  const oddsHelp = parseJsonOutput(runCli(['--output', 'json', 'odds', 'record', '--help']));
  assert.equal(oddsHelp.command, 'odds.help');
  assert.equal(descriptors.odds.helpDataSchema, '#/definitions/OddsHelpPayload');
  assert.equal(typeof oddsHelp.data.historyUsage, 'string');
  assertSchemaValid(schemaDocument, { $ref: descriptors.odds.helpDataSchema }, oddsHelp.data, 'odds.help');

  const mirrorStatusHelp = parseJsonOutput(runCli(['--output', 'json', 'mirror', 'status', '--help']));
  assert.equal(mirrorStatusHelp.command, 'mirror.status.help');
  assert.equal(descriptors['mirror.status'].helpDataSchema, '#/definitions/MirrorStatusHelpPayload');
  assert.ok(Array.isArray(mirrorStatusHelp.data.polymarketEnv));
  assert.equal(typeof mirrorStatusHelp.data.notes, 'object');
  assert.match(mirrorStatusHelp.data.usage, /--manifest-file <path>/);
  assert.match(mirrorStatusHelp.data.usage, /--indexer-url <url>/);
  assert.match(mirrorStatusHelp.data.usage, /--polymarket-gamma-url <url>/);
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors['mirror.status'].helpDataSchema },
    mirrorStatusHelp.data,
    'mirror.status.help',
  );

  const mirrorPnlHelp = parseJsonOutput(runCli(['--output', 'json', 'mirror', 'pnl', '--help']));
  assert.equal(mirrorPnlHelp.command, 'mirror.pnl.help');
  assert.equal(descriptors['mirror.pnl'].helpDataSchema, '#/definitions/CommandHelpPayload');
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors['mirror.pnl'].helpDataSchema },
    mirrorPnlHelp.data,
    'mirror.pnl.help',
  );

  const mirrorAuditHelp = parseJsonOutput(runCli(['--output', 'json', 'mirror', 'audit', '--help']));
  assert.equal(mirrorAuditHelp.command, 'mirror.audit.help');
  assert.equal(descriptors['mirror.audit'].helpDataSchema, '#/definitions/CommandHelpPayload');
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors['mirror.audit'].helpDataSchema },
    mirrorAuditHelp.data,
    'mirror.audit.help',
  );

  const polymarketWithdrawHelp = parseJsonOutput(runCli(['--output', 'json', 'polymarket', 'withdraw', '--help']));
  assert.equal(polymarketWithdrawHelp.command, 'polymarket.withdraw.help');
  assert.match(polymarketWithdrawHelp.data.usage, /polymarket withdraw --amount-usdc/);
  assert.equal(Array.isArray(polymarketWithdrawHelp.data.notes), true);
  assert.equal(
    polymarketWithdrawHelp.data.notes.some((line) => /signer controls the source wallet/i.test(String(line))),
    true,
  );

  const tradeQuoteHelp = parseJsonOutput(runCli(['--output', 'json', 'trade', 'quote', '--help']));
  assert.equal(tradeQuoteHelp.command, 'trade.quote.help');
  assert.ok(descriptors.trade.emits.includes('trade.quote.help'));

  const sellHelp = parseJsonOutput(runCli(['--output', 'json', 'sell', '--help']));
  assert.equal(sellHelp.command, 'sell.help');
  assert.ok(descriptors.sell.emits.includes('sell.help'));

  const sellQuoteHelp = parseJsonOutput(runCli(['--output', 'json', 'sell', 'quote', '--help']));
  assert.equal(sellQuoteHelp.command, 'sell.quote.help');
  assert.ok(descriptors.sell.emits.includes('sell.quote.help'));

  const simulateAgentsHelp = parseJsonOutput(runCli(['--output', 'json', 'simulate', 'agents', '--help']));
  assert.equal(simulateAgentsHelp.command, 'simulate.agents.help');
  assert.ok(descriptors['simulate.agents'].emits.includes('simulate.agents.help'));

  const lifecycleStartHelp = parseJsonOutput(runCli(['--output', 'json', 'lifecycle', 'start', '--help']));
  assert.equal(lifecycleStartHelp.command, 'lifecycle.start.help');
  assert.ok(descriptors['lifecycle.start'].emits.includes('lifecycle.start.help'));

  const capabilitiesHelp = parseJsonOutput(runCli(['--output', 'json', 'capabilities', '--help']));
  assert.equal(capabilitiesHelp.command, 'capabilities.help');
  assert.equal(descriptors.capabilities.helpDataSchema, '#/definitions/CapabilitiesHelpPayload');
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors.capabilities.helpDataSchema },
    capabilitiesHelp.data,
    'capabilities.help',
  );

  const schemaHelp = parseJsonOutput(runCli(['--output', 'json', 'schema', '--help']));
  assert.equal(schemaHelp.command, 'schema.help');
  assert.equal(descriptors.schema.helpDataSchema, '#/definitions/SchemaHelpPayload');
  assertSchemaValid(
    schemaDocument,
    { $ref: descriptors.schema.helpDataSchema },
    schemaHelp.data,
    'schema.help',
  );
});

test('every declared help payload validates against its published help schema', () => {
  const schemaEnvelope = parseJsonOutput(runCli(['--output', 'json', 'schema']));
  const schemaDocument = schemaEnvelope.data;
  const descriptors = schemaDocument.commandDescriptors;

  for (const [commandName, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.helpDataSchema || !Array.isArray(descriptor.outputModes) || !descriptor.outputModes.includes('json')) {
      continue;
    }
    if (!Array.isArray(descriptor.canonicalCommandTokens) || descriptor.canonicalCommandTokens.length === 0) {
      continue;
    }

    const result = runCli(['--output', 'json', ...descriptor.canonicalCommandTokens, '--help']);
    assert.equal(result.status, 0, `expected --help to succeed for ${commandName}: ${result.output || result.stderr}`);
    const payload = parseJsonOutput(result);
    assertSchemaValid(
      schemaDocument,
      { $ref: descriptor.helpDataSchema },
      payload.data,
      `${commandName}.help`,
    );
  }
});

test('schema and capabilities payloads validate against published definitions', () => {
  const schemaResult = runCli(['--output', 'json', 'schema']);
  assert.equal(schemaResult.status, 0);
  const schemaEnvelope = parseJsonOutput(schemaResult);
  const schemaDocument = schemaEnvelope.data;

  const capabilitiesResult = runCli(['--output', 'json', 'capabilities']);
  assert.equal(capabilitiesResult.status, 0);
  const capabilitiesEnvelope = parseJsonOutput(capabilitiesResult);

  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/SchemaCommandPayload' },
    schemaDocument,
    'schema',
  );
  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/CapabilitiesPayload' },
    capabilitiesEnvelope.data,
    'capabilities',
  );
});

test('bootstrap payload validates against its published definition', () => {
  const schemaResult = runCli(['--output', 'json', 'schema']);
  assert.equal(schemaResult.status, 0);
  const schemaEnvelope = parseJsonOutput(schemaResult);
  const schemaDocument = schemaEnvelope.data;

  const bootstrapResult = runCli(['--output', 'json', 'bootstrap']);
  assert.equal(bootstrapResult.status, 0);
  const bootstrapEnvelope = parseJsonOutput(bootstrapResult);

  assertSchemaValid(
    schemaDocument,
    { $ref: '#/definitions/BootstrapPayload' },
    bootstrapEnvelope.data,
    'bootstrap',
  );
  assert.equal(bootstrapEnvelope.data.readinessMode, 'artifact-neutral');
  assert.equal(bootstrapEnvelope.data.preferences.recommendedFirstCall, 'bootstrap');
  assert.equal(bootstrapEnvelope.data.recommendedBootstrapFlow[0], 'bootstrap');
  assert.ok(!bootstrapEnvelope.data.canonicalTools.includes('arbitrage'));
});

test('generated SDK contract bundle stays in parity with live schema and capabilities commands', () => {
  const tempDir = createTempDir('pandora-sdk-cli-parity-');
  const env = createIsolatedPandoraEnv(tempDir);

  try {
    const schemaEnvelope = parseJsonOutput(runCli(['--output', 'json', 'schema'], { env }));
    const capabilitiesEnvelope = parseJsonOutput(runCli(['--output', 'json', 'capabilities'], { env }));
    const artifact = buildSdkContractArtifact({
      packageVersion: generatedManifest.packageVersion,
      remoteTransportActive: false,
    });

    assertManifestParity(generatedManifest, artifact);
    assert.deepEqual(artifact.commandDescriptors, schemaEnvelope.data.commandDescriptors);
    assert.deepEqual(
      omitTrustDistributionDefinitions(artifact.schemas.definitions),
      omitTrustDistributionDefinitions(schemaEnvelope.data.definitions),
    );
    assert.deepEqual(
      omitTrustDistributionFromCapabilities(omitGeneratedAt(artifact.capabilities)),
      omitTrustDistributionFromCapabilities(omitGeneratedAt(capabilitiesEnvelope.data)),
    );
    assert.equal(artifact.capabilities.generatedAt, SDK_ARTIFACT_GENERATED_AT);
    assert.deepEqual(generatedContractRegistry.commandDescriptors, schemaEnvelope.data.commandDescriptors);
    assert.deepEqual(generatedContractRegistry.schemas.envelope.commandDescriptors, schemaEnvelope.data.commandDescriptors);
    assert.deepEqual(
      omitTrustDistributionDefinitions(generatedContractRegistry.schemas.envelope.definitions),
      omitTrustDistributionDefinitions(artifact.schemas.envelope.definitions),
    );
    assert.deepEqual(
      omitTrustDistributionFromCapabilities(omitGeneratedAt(generatedContractRegistry.capabilities)),
      omitTrustDistributionFromCapabilities(omitGeneratedAt(artifact.capabilities)),
    );
    assert.deepEqual(
      {
        ...omitGeneratedAt(artifact.schemas.envelope),
        definitions: omitTrustDistributionDefinitions(artifact.schemas.envelope.definitions),
      },
      {
        ...omitGeneratedAt(schemaEnvelope.data),
        definitions: omitTrustDistributionDefinitions(schemaEnvelope.data.definitions),
      },
      'SDK schema bundle should match the live schema payload aside from deterministic generatedAt and live trust-distribution definitions.',
    );
    assert.equal(
      artifact.schemas.envelope.schemaVersion,
      schemaEnvelope.data.schemaVersion,
      'SDK schema bundle should preserve schemaVersion from the live schema command payload.',
    );
    assert.equal(
      artifact.schemas.envelope.generatedAt,
      SDK_ARTIFACT_GENERATED_AT,
      'SDK schema bundle should stamp a deterministic generatedAt for packaged SDK artifacts.',
    );
  } finally {
    removeDir(tempDir);
  }
});

test('schema command rejects unknown trailing flags', () => {
  const result = runCli(['--output', 'json', 'schema', '--bad-flag']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_ARGS');
});

test('capabilities command requires --output json mode', () => {
  const result = runCli(['capabilities']);
  assert.equal(result.status, 1);
  assert.match(result.output, /\[INVALID_USAGE\]/);
  assert.match(result.output, /only supported in --output json mode/i);
});

test('capabilities --help succeeds in table mode', () => {
  const result = runCli(['capabilities', '--help']);
  assert.equal(result.status, 0);
  assert.match(String(result.stdout || ''), /Usage:\s+pandora --output json capabilities/);
});

  test('capabilities command returns a derived command-contract digest', () => {
  const schemaResult = runCli(['--output', 'json', 'schema']);
  assert.equal(schemaResult.status, 0);
  const schemaPayload = parseJsonOutput(schemaResult);
  const result = runCli(['--output', 'json', 'capabilities']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  const capabilityBytes = Buffer.byteLength(result.stdout || '', 'utf8');
  const schemaBytes = Buffer.byteLength(schemaResult.stdout || '', 'utf8');
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'capabilities');

  assert.equal(payload.data.title, 'PandoraCliCapabilities');
  assert.equal(payload.data.source, 'agent_contract_registry');
  assert.equal(payload.data.commandDescriptorVersion, schemaPayload.data.commandDescriptorVersion);
  assert.deepEqual(payload.data.trustDistribution, schemaPayload.data.trustDistribution);
  assert.equal(payload.data.trustDistribution.distribution.rootPackage.name, repoPackage.name);
  assert.equal(payload.data.trustDistribution.distribution.rootPackage.version, repoPackage.version);
  assert.equal(payload.data.trustDistribution.verification.benchmark.reportPresent, true);
  assert.equal(
    payload.data.trustDistribution.verification.benchmark.reportOverallPass,
    latestBenchmarkReport.summary.overallPass,
  );
  assert.equal(
    payload.data.trustDistribution.verification.benchmark.reportContractLockMatchesExpected,
    latestBenchmarkReport.contractLockMatchesExpected,
  );
  assert.deepEqual(
    payload.data.trustDistribution.distribution.rootPackage.binNames,
    Object.keys(repoPackage.bin || {}).sort(),
  );
  assert.equal(
    payload.data.trustDistribution.distribution.generatedContractArtifacts.artifactVersion,
    generatedManifest.artifactVersion,
  );
  assert.equal(
    payload.data.trustDistribution.distribution.embeddedSdks.typescript.packageName,
    typescriptSdkPackage.name,
  );
  assert.deepEqual(payload.data.transports.sdk.packages.typescript.installExamples, [
    `npm install ${typescriptSdkPackage.name}@${typescriptSdkPackage.version}`,
    'npm install /path/to/downloaded/pandora-agent-sdk-<version>.tgz',
  ]);
  assert.equal(
    payload.data.trustDistribution.distribution.embeddedSdks.python.packageName,
    parseTomlStringField(
      fs.readFileSync(path.join(__dirname, '..', '..', 'sdk', 'python', 'pyproject.toml'), 'utf8'),
      'name',
    ),
  );
  assert.deepEqual(payload.data.transports.sdk.packages.python.installExamples, [
    `pip install ${payload.data.trustDistribution.distribution.embeddedSdks.python.packageName}==${payload.data.trustDistribution.distribution.embeddedSdks.python.version}`,
    'pip install /path/to/downloaded/pandora_agent-<version>-py3-none-any.whl',
    'pip install /path/to/downloaded/pandora_agent-<version>.tar.gz',
  ]);
  assert.equal(payload.data.trustDistribution.verification.scripts.build, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.prepack, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.benchmarkCheck, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.checkReleaseTrust, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.generateSbom, null);
  assert.equal(payload.data.trustDistribution.verification.scripts.releasePrep, null);
  assert.equal(payload.data.trustDistribution.distribution.platformValidation.release.workflowPath, '.github/workflows/release.yml');
  assert.ok(payload.data.trustDistribution.distribution.platformValidation.release.osMatrix.includes('ubuntu-latest'));
  assert.equal(payload.data.trustDistribution.verification.ciWorkflow.present, false);
  assert.ok(
    payload.data.trustDistribution.verification.releaseAssets.names.includes(
      `pandora-cli-skills-${repoPackage.version}.tgz.intoto.jsonl`,
    ),
  );
  assert.ok(payload.data.trustDistribution.verification.releaseAssets.verificationMethods.includes('github-build-provenance-attestation'));
  assert.equal(payload.data.trustDistribution.verification.signals.prepublishOnlyRunsTest, false);
  assert.equal(payload.data.trustDistribution.verification.signals.testRunsSmoke, false);
  assert.equal(payload.data.trustDistribution.verification.signals.smokeTestsPresent, false);
  assert.equal(payload.data.trustDistribution.verification.signals.buildRunsReleaseTrustCheck, false);
  assert.equal(payload.data.trustDistribution.verification.signals.prepackRunsReleaseTrustCheck, false);
  assert.equal(payload.data.trustDistribution.verification.signals.trustDocsPresent, true);
  assert.equal(payload.data.trustDistribution.verification.signals.releasePrepRunsSbom, false);
  assert.equal(payload.data.trustDistribution.verification.signals.releasePrepRunsTrustCheck, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsTrustDocs, true);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsReleaseTrustScripts, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsBenchmarkHarness, false);
  assert.equal(payload.data.trustDistribution.distribution.signals.shipsBenchmarkReport, true);
  assert.equal(payload.data.trustDistribution.releaseGates.commands.test, repoPackage.scripts.test);
  assert.equal(payload.data.trustDistribution.releaseGates.commands.releasePrep, repoPackage.scripts['release:prep']);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.workflowRunsNpmTest, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.workflowRunsReleasePrep, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.repoTestRunsSmoke, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.repoReleasePrepRunsSmoke, true);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.publishedSmokeCommandExposed, false);
  assert.equal(payload.data.trustDistribution.releaseGates.signals.packagedSmokeFixturesPresent, false);
  assert.ok(payload.data.summary.totalCommands > 0);
  assert.ok(payload.data.summary.mcpExposedCommands > 0);
  assert.ok(payload.data.outputModeMatrix.jsonOnly.includes('schema'));
  assert.ok(payload.data.outputModeMatrix.tableOnly.includes('mcp'));
  assert.ok(payload.data.outputModeMatrix.tableAndJson.includes('quote'));
  assert.ok(payload.data.topLevelCommands.markets);
  assert.ok(payload.data.topLevelCommands.arb);
  assert.ok(payload.data.routedTopLevelCommands.includes('arb'));
  assert.ok(payload.data.topLevelCommands.markets.childCommands.includes('markets.list'));
  assert.ok(payload.data.namespaces.mirror.commands.includes('mirror.plan'));
  assert.ok(payload.data.namespaces.agent.mcpExposedCommands.includes('agent.market.validate'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.id === 'release-verification'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.id === 'security-model'));
  assert.ok(payload.data.documentation.skills.some((doc) => doc.id === 'support-matrix'));
  assert.ok(payload.data.documentation.router.taskRoutes.some((route) => route.label === 'Release verification, support matrix, or security posture'));
  assert.equal(payload.data.discoveryPreferences.canonicalOnlyDefault, true);
  assert.equal(payload.data.discoveryPreferences.includeCompatibility, false);
  assert.ok(payload.data.discoveryPreferences.hiddenAliasCount >= 1);
  assert.deepEqual(payload.data.canonicalTools['arb.scan'].commands, ['arb.scan']);
  assert.equal(payload.data.canonicalTools['arb.scan'].preferredCommand, 'arb.scan');
    assert.ok(payload.data.commandDigests.quote);
  assert.equal(Object.keys(payload.data.commandDigests).length, Object.keys(schemaPayload.data.commandDescriptors).length);
    assert.equal(payload.data.commandDigests.quote.summary.length > 0, true);
    assert.deepEqual(payload.data.commandDigests.trade.canonicalCommandTokens, ['trade']);
  assert.ok(payload.data.commandDigests.trade.emits.includes('trade'));
  assert.deepEqual(payload.data.commandDigests.trade.safeFlags, ['--dry-run']);
  assert.deepEqual(payload.data.commandDigests.trade.executeFlags, ['--execute']);
  assert.equal(payload.data.commandDigests.trade.executeIntentRequired, false);
  assert.equal(payload.data.commandDigests.trade.executeIntentRequiredForLiveMode, true);
  assert.deepEqual(payload.data.commandDigests.trade.requiredInputs, ['amount-usdc', 'market-address', 'side']);
  assert.equal(payload.data.commandDigests.trade.remoteEligible, true);
  assert.equal(payload.data.commandDigests.trade.safeEquivalent, 'quote');
  assert.equal(payload.data.commandDigests.trade.recommendedPreflightTool, 'quote');
  assert.equal(payload.data.commandDigests.capabilities.supportsRemote, true);
  assert.equal(payload.data.commandDigests.capabilities.remoteEligible, true);
  assert.equal(payload.data.commandDigests.capabilities.remoteTransportActive, false);
  assert.equal(payload.data.transports.mcpStreamableHttp.supported, true);
  assert.equal(payload.data.transports.mcpStreamableHttp.status, 'inactive');
  assert.ok(
    payload.data.transports.mcpStreamableHttp.notes.some((note) => /inactive/i.test(note) && /pandora mcp http/i.test(note)),
  );
  assert.ok(
    payload.data.versionCompatibility.notes.some((note) => /inactive/i.test(note) && /streamable http/i.test(note)),
  );
  assert.ok(payload.data.roadmapSignals.remoteEligibleCommands > 0);
  assert.ok(payload.data.commandDigests['mirror.sync.start'].externalDependencies.includes('wallet-secrets'));
  assert.ok(payload.data.commandDigests['mirror.sync.start'].externalDependencies.includes('notification-secrets'));
  assert.equal(payload.data.commandDigests.trade.remotePlanned, true);
  assert.equal(payload.data.commandDigests['mirror.sync.start'].returnsOperationId, true);
  assert.equal(payload.data.commandDigests['mirror.sync.start'].returnsRuntimeHandle, false);
  assert.equal(payload.data.commandDigests['mirror.sync.stop'].returnsRuntimeHandle, false);
  assert.equal(payload.data.commandDigests.help.canRunConcurrent, true);
  assert.equal(payload.data.registryDigest.descriptorHash.length, 64);
  assert.equal(payload.data.registryDigest.descriptorHash, stableJsonHash(schemaPayload.data.commandDescriptors));
  assert.equal(payload.data.registryDigest.commandDigestHash.length, 64);
  assert.equal(payload.data.registryDigest.commandDigestHash, stableJsonHash(payload.data.commandDigests));
  assert.equal(payload.data.registryDigest.canonicalHash, stableJsonHash(payload.data.canonicalTools));
  assert.equal(payload.data.registryDigest.topLevelHash, stableJsonHash(payload.data.topLevelCommands));
  assert.equal(payload.data.registryDigest.routedTopLevelHash, stableJsonHash(payload.data.routedTopLevelCommands));
  assert.equal(payload.data.registryDigest.namespaceHash, stableJsonHash(payload.data.namespaces));
  assert.equal(payload.data.summary.discoveryCommands, Object.keys(schemaPayload.data.commandDescriptors).length);
  assert.ok(capabilityBytes < schemaBytes * 0.5, `capabilities should stay materially smaller than schema (${capabilityBytes} vs ${schemaBytes})`);
  assert.ok(capabilityBytes < 300000, `capabilities payload should stay compact (${capabilityBytes} bytes)`);
  });

test('capabilities command can include compatibility aliases explicitly', () => {
  const result = runCli(['--output', 'json', 'capabilities', '--include-compatibility']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'capabilities');
  assert.equal(payload.data.discoveryPreferences.includeCompatibility, true);
  assert.ok(payload.data.commandDigests.arbitrage);
  assert.equal(payload.data.commandDigests.arbitrage.aliasOf, 'arb.scan');
  assert.equal(
    Object.keys(payload.data.commandDigests).length,
    Object.keys(buildSchemaPayload({ includeCompatibility: true }).commandDescriptors).length,
  );
  assert.ok(payload.data.canonicalTools['arb.scan'].commands.includes('arbitrage'));
});

  test('json help payload includes output-mode routing notes', () => {
    const result = runCli(['--output', 'json', 'help']);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.data.notes));
  assert.ok(payload.data.usage.some((line) => /markets mine/.test(line)));
  assert.ok(payload.data.usage.some((line) => /mirror .*logs/.test(line)));
  assert.deepEqual(payload.data.modeRouting, {
    jsonOnly: ['bootstrap', 'capabilities', 'schema'],
    stdioOnly: ['mcp'],
    scriptNative: ['launch', 'clone-bet'],
  });
  assert.ok(
    payload.data.notes.some(
      (note) => /json-only/i.test(note) && /bootstrap/i.test(note) && /capabilities/i.test(note) && /schema/i.test(note),
    ),
  );
  assert.ok(payload.data.notes.some((note) => /mcp/i.test(note) && /stdio server mode/i.test(note)));
  assert.ok(payload.data.usage.some((entry) => /markets mine/.test(String(entry))));
  assert.ok(payload.data.usage.some((entry) => /mirror .*logs/.test(String(entry))));
  });

test('capabilities command rejects unknown trailing flags', () => {
  const result = runCli(['--output', 'json', 'capabilities', '--bad-flag']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_ARGS');
});

test('mcp command rejects --output json mode with stable CLI error', () => {
  const result = runCli(['--output', 'json', 'mcp']);
  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNSUPPORTED_OUTPUT_MODE');
});

test('json success envelopes include schemaVersion and generatedAt metadata', () => {
  const result = runCli(['--output', 'json', 'quote', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.data.schemaVersion, 'string');
  assertIsoTimestamp(payload.data.generatedAt);
});

test('risk show and panic commands manage state in json envelopes', () => {
  const tempHome = createTempDir('pandora-risk-cli-');
  try {
    const env = { HOME: tempHome, PANDORA_RISK_FILE: path.join(tempHome, 'risk.json') };

    const showInitial = runCli(['--output', 'json', 'risk', 'show'], { env });
    assert.equal(showInitial.status, 0);
    const showInitialPayload = parseJsonOutput(showInitial);
    assert.equal(showInitialPayload.ok, true);
    assert.equal(showInitialPayload.command, 'risk.show');
    assert.equal(showInitialPayload.data.panic.active, false);

    const engage = runCli(['--output', 'json', 'risk', 'panic', '--reason', 'incident test'], { env });
    assert.equal(engage.status, 0);
    const engagePayload = parseJsonOutput(engage);
    assert.equal(engagePayload.ok, true);
    assert.equal(engagePayload.command, 'risk.panic');
    assert.equal(engagePayload.data.action, 'engage');
    assert.equal(engagePayload.data.panic.active, true);
    assert.equal(Array.isArray(engagePayload.data.stopFiles), true);
    assert.equal(engagePayload.data.stopFiles.length, 0);

    const showAfter = runCli(['--output', 'json', 'risk', 'show'], { env });
    assert.equal(showAfter.status, 0);
    const showAfterPayload = parseJsonOutput(showAfter);
    assert.equal(showAfterPayload.data.panic.active, true);

    const clear = runCli(['--output', 'json', 'risk', 'panic', '--clear'], { env });
    assert.equal(clear.status, 0);
    const clearPayload = parseJsonOutput(clear);
    assert.equal(clearPayload.ok, true);
    assert.equal(clearPayload.command, 'risk.panic');
    assert.equal(clearPayload.data.action, 'clear');
    assert.equal(clearPayload.data.panic.active, false);
  } finally {
    removeDir(tempHome);
  }
});

test('risk panic blocks live writes before onchain execution', () => {
  const tempHome = createTempDir('pandora-risk-block-live-');
  const env = { HOME: tempHome, PANDORA_RISK_FILE: path.join(tempHome, 'risk.json') };
  try {
    const panic = runCli(['--output', 'json', 'risk', 'panic', '--reason', 'block all'], { env });
    assert.equal(panic.status, 0);

    const blocked = runCli([
      '--output', 'json', 'resolve',
      '--poll-address', ADDRESSES.mirrorPoll,
      '--answer', 'yes',
      '--reason', 'manual resolve',
      '--execute',
    ], { env });
    assert.equal(blocked.status, 1);
    const payload = parseJsonOutput(blocked);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'RISK_PANIC_ACTIVE');
  } finally {
    removeDir(tempHome);
  }
});

test('operations list/get/receipt/verify-receipt/cancel/close manage durable operation records in json envelopes', async () => {
  const tempDir = createTempDir('pandora-operations-cli-');
  try {
    const schemaPayload = parseJsonOutput(runCli(['--output', 'json', 'schema']));
    const schemaDocument = schemaPayload.data;
    const descriptors = schemaDocument.commandDescriptors;
    const operationDir = path.join(tempDir, 'operations');
    const service = createOperationService({
      operationStateStore: createOperationStateStore({ rootDir: operationDir }),
    });
    const created = await service.createCompleted({
      command: 'mirror.deploy',
      request: { marketAddress: ADDRESSES.mirrorMarket, execute: false },
      summary: 'Mirror deploy test',
      result: { txHash: '0xabc123' },
    });
    const planned = await service.createPlanned({
      command: 'mirror.sync.start',
      request: { marketAddress: ADDRESSES.mirrorMarket, execute: false },
      summary: 'Mirror sync plan',
    });
    const env = { HOME: tempDir, PANDORA_OPERATION_DIR: operationDir };

    const listResult = runCli(['--output', 'json', 'operations', 'list', '--status', 'planned'], { env });
    assert.equal(listResult.status, 0);
    const listPayload = parseJsonOutput(listResult);
    assert.equal(listPayload.command, 'operations.list');
    assert.equal(listPayload.data.count, 1);
    assert.equal(listPayload.data.items[0].operationId, planned.operationId);
    assertSchemaValid(schemaDocument, { $ref: descriptors['operations.list'].dataSchema }, listPayload.data, 'operations.list');

    const completedListResult = runCli(['--output', 'json', 'operations', 'list', '--status', 'completed'], { env });
    assert.equal(completedListResult.status, 0);
    const completedListPayload = parseJsonOutput(completedListResult);
    assert.equal(completedListPayload.data.count, 1);
    assert.equal(completedListPayload.data.items[0].operationId, created.operationId);

    const getResult = runCli(['--output', 'json', 'operations', 'get', '--id', created.operationId], { env });
    assert.equal(getResult.status, 0);
    const getPayload = parseJsonOutput(getResult);
    assert.equal(getPayload.command, 'operations.get');
    assert.equal(getPayload.data.operationId, created.operationId);
    assertSchemaValid(schemaDocument, { $ref: descriptors['operations.get'].dataSchema }, getPayload.data, 'operations.get');

    const receiptResult = runCli(['--output', 'json', 'operations', 'receipt', '--id', created.operationId], { env });
    assert.equal(receiptResult.status, 0);
    const receiptPayload = parseJsonOutput(receiptResult);
    assert.equal(receiptPayload.command, 'operations.receipt');
    assert.equal(receiptPayload.data.operationId, created.operationId);
    assert.equal(receiptPayload.data.result.txHash, '0xabc123');
    assertSchemaValid(schemaDocument, { $ref: descriptors['operations.receipt'].dataSchema }, receiptPayload.data, 'operations.receipt');

    const receiptFile = createOperationStateStore({ rootDir: operationDir }).receiptFile(created.operationId);
    const verifyResult = runCli(['--output', 'json', 'operations', 'verify-receipt', '--file', receiptFile], { env });
    assert.equal(verifyResult.status, 0);
    const verifyPayload = parseJsonOutput(verifyResult);
    assert.equal(verifyPayload.command, 'operations.verify-receipt');
    assert.equal(verifyPayload.data.ok, true);
    assert.equal(verifyPayload.data.source.type, 'file');
    assertSchemaValid(schemaDocument, { $ref: descriptors['operations.verify-receipt'].dataSchema }, verifyPayload.data, 'operations.verify-receipt');

    const verifyByIdResult = runCli(['--output', 'json', 'operations', 'verify-receipt', '--id', created.operationId], { env });
    assert.equal(verifyByIdResult.status, 0);
    const verifyByIdPayload = parseJsonOutput(verifyByIdResult);
    assert.equal(verifyByIdPayload.command, 'operations.verify-receipt');
    assert.equal(verifyByIdPayload.data.ok, true);
    assert.equal(verifyByIdPayload.data.source.type, 'operation-id');
    assert.equal(verifyByIdPayload.data.source.value, created.operationId);

    const verifyWrongHashResult = runCli([
      '--output', 'json', 'operations', 'verify-receipt', '--file', receiptFile,
      '--expected-operation-hash', 'f'.repeat(64),
    ], { env });
    assert.equal(verifyWrongHashResult.status, 0);
    const verifyWrongHashPayload = parseJsonOutput(verifyWrongHashResult);
    assert.equal(verifyWrongHashPayload.command, 'operations.verify-receipt');
    assert.equal(verifyWrongHashPayload.data.ok, false);
    assert.match(verifyWrongHashPayload.data.mismatches.join(' | '), /operationHash/i);

    const cancelResult = runCli(['--output', 'json', 'operations', 'cancel', '--id', planned.operationId, '--reason', 'stop'], { env });
    assert.equal(cancelResult.status, 0);
    const cancelPayload = parseJsonOutput(cancelResult);
    assert.equal(cancelPayload.command, 'operations.cancel');
    assert.equal(cancelPayload.data.status, 'canceled');

    const closeResult = runCli(['--output', 'json', 'operations', 'close', '--id', cancelPayload.data.operationId], { env });
    assert.equal(closeResult.status, 0);
    const closePayload = parseJsonOutput(closeResult);
    assert.equal(closePayload.command, 'operations.close');
    assert.equal(closePayload.data.status, 'closed');
  } finally {
    removeDir(tempDir);
  }
});

test('mirror close dry-run decorates payloads with a durable operation record', () => {
  const tempDir = createTempDir('pandora-mirror-close-operation-');
  try {
    const operationDir = path.join(tempDir, 'operations');
    const env = {
      HOME: tempDir,
      PANDORA_OPERATION_DIR: operationDir,
    };
    const result = runCli(['--output', 'json', 'mirror', 'close', '--all', '--dry-run'], { env });
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.command, 'mirror.close');
    assert.match(payload.data.operationId, /^mirror-close/);

    const store = createOperationStateStore({ rootDir: operationDir });
    const lookup = store.get(payload.data.operationId);
    assert.equal(lookup.found, true);
    assert.equal(lookup.operation.command, 'mirror.close');
    assert.equal(lookup.operation.status, 'planned');
  } finally {
    removeDir(tempDir);
  }
});

test('init-env copies example file and enforces --force overwrite', () => {
  const tempDir = createTempDir('pandora-init-env-');
  const examplePath = path.join(tempDir, 'fixtures', 'custom.example.env');
  const targetPath = path.join(tempDir, 'runtime', '.env');
  const exampleContent = ['ALPHA=1', 'BETA=2', 'GAMMA=3'].join('\n');

  writeFile(examplePath, exampleContent);

  const first = runCli(['init-env', '--example', examplePath, '--dotenv-path', targetPath]);
  assert.equal(first.status, 0);
  assert.match(first.output, /Wrote env file:/);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), exampleContent);

  const second = runCli(['init-env', '--example', examplePath, '--dotenv-path', targetPath]);
  assert.equal(second.status, 1);
  assert.match(second.output, /Env file already exists:/);

  const forced = runCli(['init-env', '--force', '--example', examplePath, '--dotenv-path', targetPath]);
  assert.equal(forced.status, 0);
  assert.match(forced.output, /Wrote env file:/);

  removeDir(tempDir);
});

setupTest('setup --help returns structured JSON help payload', () => {
  const result = runCli(['--output', 'json', 'setup', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'setup.help');
  assert.match(payload.data.usage, /^pandora .* setup /);
  assert.match(payload.data.usage, /--interactive/);
  assert.match(payload.data.usage, /--plan/);
  assert.match(payload.data.usage, /--goal/);
  assert.match(payload.data.usage, /paper-mirror/);
  assert.match(payload.data.usage, /hosted-gateway/);
  assert.equal(payload.data.schemaVersion, '1.0.0');
  assertIsoTimestamp(payload.data.generatedAt);
});

test('doctor --help exposes goal-aware readiness guidance', () => {
  const result = runCli(['--output', 'json', 'doctor', '--help']);
  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.command, 'doctor.help');
  assert.match(payload.data.usage, /--goal/);
  assert.match(payload.data.usage, /deploy/);
  assert.match(payload.data.usage, /live-mirror/);
});

test('init-env writes env files with 0600 permissions (non-Windows)', () => {
  const tempDir = createTempDir('pandora-init-env-mode-');
  const examplePath = path.join(tempDir, 'example.env');
  const envPath = path.join(tempDir, 'generated.env');
  writeFile(examplePath, 'CHAIN_ID=1\n');

  const result = runCli([
    '--output',
    'json',
    'init-env',
    '--example',
    examplePath,
    '--dotenv-path',
    envPath,
  ]);

  assert.equal(result.status, 0);
  const payload = parseJsonOutput(result);
  assert.equal(payload.ok, true);
  assert.equal(fs.existsSync(envPath), true);
  if (process.platform !== 'win32') {
    const mode = fs.statSync(envPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  removeDir(tempDir);
});

test('doctor reports missing required env vars in json mode', () => {
  const tempDir = createTempDir('pandora-doctor-missing-');
  const envPath = path.join(tempDir, 'missing.env');

  writeFile(envPath, 'CHAIN_ID=1\n');

  const result = runCli(['--output', 'json', 'doctor', '--dotenv-path', envPath], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'DOCTOR_FAILED');
  assert.equal(payload.error.details.report.env.required.ok, false);
  assert.ok(payload.error.details.report.env.required.missing.includes('RPC_URL'));

  removeDir(tempDir);
});

test('doctor supports --env-file alias', () => {
  const tempDir = createTempDir('pandora-doctor-env-file-');
  const envPath = path.join(tempDir, 'valid.env');

  writeFile(envPath, buildValidEnv('http://127.0.0.1:1'));

  const result = runCli(['doctor', '--env-file', envPath], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /RPC request failed:/);
  removeDir(tempDir);
});

test('doctor fails on missing --dotenv-path value', () => {
  const result = runCli(['doctor', '--dotenv-path']);
  assert.equal(result.status, 1);
  assert.match(result.output, /Missing value for --dotenv-path/);
});

test('init-env rejects unknown flags', () => {
  const result = runCli(['init-env', '--bogus']);
  assert.equal(result.status, 1);
  assert.match(result.output, /Unknown flag for init-env: --bogus/);
});

test('doctor fails when RPC is unreachable', () => {
  const tempDir = createTempDir('pandora-doctor-rpc-down-');
  const envPath = path.join(tempDir, 'rpc-down.env');

  writeFile(envPath, buildValidEnv('http://127.0.0.1:1'));

  const result = runCli(['--output', 'json', 'doctor', '--dotenv-path', envPath], {
    unsetEnvKeys: DOCTOR_ENV_KEYS,
  });

  assert.equal(result.status, 1);
  const payload = parseJsonOutput(result);
  assert.equal(payload.error.code, 'DOCTOR_FAILED');
  assert.equal(payload.error.details.report.rpc.ok, false);

  removeDir(tempDir);
});

test('doctor validates rpc reachability and contract bytecode checks', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [ADDRESSES.oracle]: '0x6001600101',
      [ADDRESSES.factory]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-doctor-valid-');
  const envPath = path.join(tempDir, 'valid.env');

  try {
    writeFile(envPath, buildValidEnv(rpcServer.url));

    const result = await runCliAsync(['doctor', '--dotenv-path', envPath], {
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    assert.match(result.output, /Doctor checks passed\./);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

test('doctor --goal paper-mirror does not require PANDORA_RESOLUTION_SOURCES', async () => {
  const oracleAddress = '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442';
  const factoryAddress = '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c';
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [oracleAddress]: '0x6001600101',
      [factoryAddress]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-doctor-paper-mirror-');
  const envPath = path.join(tempDir, 'paper-mirror.env');

  try {
    writeFile(
      envPath,
      [
        'CHAIN_ID=1',
        `RPC_URL=${rpcServer.url}`,
        `ORACLE=${oracleAddress}`,
        `FACTORY=${factoryAddress}`,
        'USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      ].join('\n'),
    );

    const result = await runCliAsync(['--output', 'json', 'doctor', '--goal', 'paper-mirror', '--dotenv-path', envPath], {
      unsetEnvKeys: [...DOCTOR_ENV_KEYS, 'PANDORA_RESOLUTION_SOURCES'],
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.summary.ok, true);
    assert.equal(payload.data.journeyReadiness.status, 'ready');
    assert.equal(payload.data.journeyReadiness.missing.includes('PANDORA_RESOLUTION_SOURCES'), false);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

test('doctor --goal hosted-gateway stays read-only and signer-free', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {},
  });

  const tempDir = createTempDir('pandora-doctor-hosted-gateway-');
  const envPath = path.join(tempDir, 'hosted-gateway.env');

  try {
    writeFile(
      envPath,
      [
        'CHAIN_ID=1',
        `RPC_URL=${rpcServer.url}`,
      ].join('\n'),
    );

    const result = await runCliAsync(['--output', 'json', 'doctor', '--goal', 'hosted-gateway', '--dotenv-path', envPath], {
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.goal, 'hosted-gateway');
    assert.equal(payload.data.journeyReadiness.goal, 'hosted-gateway');
    assert.equal(payload.data.journeyReadiness.status, 'ready');
    assert.equal(payload.data.summary.ok, true);
    assert.equal(payload.data.env.required.ok, true);
    assert.equal(payload.data.env.required.missing.length, 0);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

test('doctor --goal paper-hedge-daemon stays daemon-oriented and source-free', async () => {
  const oracleAddress = '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442';
  const factoryAddress = '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c';
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [oracleAddress]: '0x6001600101',
      [factoryAddress]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-doctor-paper-hedge-daemon-');
  const envPath = path.join(tempDir, 'paper-hedge-daemon.env');
  const walletFile = path.join(tempDir, 'internal-wallets.txt');

  try {
    writeFile(walletFile, `${ADDRESSES.wallet1}\n`);
    writeFile(
      envPath,
      [
        'CHAIN_ID=1',
        `RPC_URL=${rpcServer.url}`,
        `ORACLE=${oracleAddress}`,
        `FACTORY=${factoryAddress}`,
        'USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        `PANDORA_INTERNAL_WALLETS_FILE=${walletFile}`,
      ].join('\n'),
    );

    const result = await runCliAsync(['--output', 'json', 'doctor', '--goal', 'paper-hedge-daemon', '--dotenv-path', envPath], {
      unsetEnvKeys: [...DOCTOR_ENV_KEYS, 'PANDORA_RESOLUTION_SOURCES'],
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.goal, 'paper-hedge-daemon');
    assert.equal(payload.data.summary.ok, true);
    assert.equal(payload.data.journeyReadiness.status, 'ready');
    assert.equal(payload.data.journeyReadiness.missing.includes('PANDORA_RESOLUTION_SOURCES'), false);
    assert.equal(
      payload.data.journeyReadiness.recommendations.some((step) => /mirror hedge/i.test(String(step))),
      true,
    );
    assert.equal(
      payload.data.journeyReadiness.recommendations.some((step) => /DigitalOcean|generic VPS|Cloudflare Workers/i.test(String(step))),
      true,
    );
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

setupTest('setup creates env and coordinates doctor checks', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [ADDRESSES.oracle]: '0x6001600101',
      [ADDRESSES.factory]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-setup-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(examplePath, buildValidEnv(rpcServer.url));

    const result = await runCliAsync([
      '--output',
      'json',
      'setup',
      '--example',
      examplePath,
      '--dotenv-path',
      envPath,
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(envPath), true);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.envStep.status, 'written');
    assert.equal(payload.data.doctor.summary.ok, true);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

setupTest('setup --plan exposes machine-readable planning data for read-only goals', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {},
  });

  const tempDir = createTempDir('pandora-setup-plan-json-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(
      examplePath,
      [
        'CHAIN_ID=1',
        `RPC_URL=${rpcServer.url}`,
      ].join('\n'),
    );

    const result = await runCliAsync([
      '--output',
      'json',
      'setup',
      '--plan',
      '--goal',
      'explore',
      '--example',
      examplePath,
      '--dotenv-path',
      envPath,
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.goal, 'explore');
    assert.equal(payload.data.mode, 'plan');
    assert.equal(payload.data.runtimeInfo.goal, 'explore');
    assert.equal(payload.data.envStep.status, 'no-env');
    assert.equal(payload.data.readiness.goal, 'explore');
    assert.equal(payload.data.doctor.summary.ok, false);
    assert.equal(Array.isArray(payload.data.guidedNextSteps), true);
    assert.ok(payload.data.plan);
    assert.equal(fs.existsSync(envPath), false);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

setupTest('setup --plan exposes reviewable mirror planning without writing files', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [ADDRESSES.oracle]: '0x6001600101',
      [ADDRESSES.factory]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-setup-plan-paper-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(
      examplePath,
      buildValidEnv(rpcServer.url, {
        ORACLE: ADDRESSES.oracle,
        FACTORY: ADDRESSES.factory,
      }),
    );
    writeFile(envPath, buildValidEnv(rpcServer.url, {
      ORACLE: ADDRESSES.oracle,
      FACTORY: ADDRESSES.factory,
    }));

    const result = await runCliAsync([
      '--output',
      'json',
      'setup',
      '--plan',
      '--goal',
      'paper-mirror',
      '--example',
      examplePath,
      '--dotenv-path',
      envPath,
    ], {
      unsetEnvKeys: [...DOCTOR_ENV_KEYS, 'PANDORA_RESOLUTION_SOURCES'],
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.mode, 'plan');
    assert.equal(payload.data.goal, 'paper-mirror');
    assert.equal(payload.data.envStep.status, 'existing-env');
    assert.equal(payload.data.plan.goal, 'paper-mirror');
    assert.deepEqual(payload.data.plan.steps.map((step) => step.id), [
      'runtime-basics',
      'pandora-signer',
      'polymarket-connectivity',
      'polymarket-signer',
      'hosting',
      'sports-odds',
      'resolution-sources',
      'review',
    ]);
    assert.equal(payload.data.doctor.journeyReadiness.goal, 'paper-mirror');
    assert.equal(payload.data.doctor.summary.ok, true);
    assert.equal(fs.existsSync(envPath), true);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

test('setup planning surface keeps read-only goals signer-free by default', () => {
  const plan = buildSetupPlan({
    goal: 'explore',
    currentEnv: {
      CHAIN_ID: '1',
      RPC_URL: 'https://rpc.example.org',
    },
  });

  assert.equal(plan.mode, 'plan');
  assert.equal(plan.goal, 'explore');
  assert.deepEqual(plan.goals.map((goal) => goal.id), [
    'explore',
    'hosted-gateway',
    'paper-mirror',
    'live-mirror',
    'paper-hedge-daemon',
    'live-hedge-daemon',
    'deploy',
  ]);
  assert.deepEqual(plan.steps.map((step) => step.id), ['runtime-basics', 'review']);
  assert.deepEqual(plan.steps[0].writesEnv, ['CHAIN_ID', 'RPC_URL']);
  assert.equal(plan.steps.some((step) => /signer|hosting|sports|resolution/i.test(step.id)), false);
  assert.match(plan.notes.join('\n'), /doctor --goal/i);
  assert.match(plan.steps.at(-1).description, /redacted change set/i);
});

test('setup planning surface keeps hosted-gateway read-only and signer-free', () => {
  const plan = buildSetupPlan({
    goal: 'hosted-gateway',
    currentEnv: {
      CHAIN_ID: '1',
      RPC_URL: 'https://rpc.example.org',
    },
  });

  assert.equal(plan.mode, 'plan');
  assert.equal(plan.goal, 'hosted-gateway');
  assert.deepEqual(plan.steps.map((step) => step.id), ['runtime-basics', 'hosting', 'review']);
  assert.equal(plan.steps.some((step) => /signer/i.test(step.id)), false);
  assert.equal(plan.steps.find((step) => step.id === 'hosting').decision.defaultSelected, true);
  assert.match(plan.description, /read-only defaults/i);
});

test('setup planning surface makes review the final step for paper-mirror', () => {
  const plan = buildSetupPlan({
    goal: 'paper-mirror',
    currentEnv: {
      CHAIN_ID: '1',
      RPC_URL: 'https://rpc.example.org',
      ORACLE: '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442',
      FACTORY: '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
  });

  assert.equal(plan.mode, 'plan');
  assert.equal(plan.goal, 'paper-mirror');
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'runtime-basics',
    'pandora-signer',
    'polymarket-connectivity',
    'polymarket-signer',
    'hosting',
    'sports-odds',
    'resolution-sources',
    'review',
  ]);

  const pandoraSigner = plan.steps.find((step) => step.id === 'pandora-signer');
  const polymarketConnectivity = plan.steps.find((step) => step.id === 'polymarket-connectivity');
  const polymarketSigner = plan.steps.find((step) => step.id === 'polymarket-signer');
  const review = plan.steps.at(-1);

  assert.equal(pandoraSigner.decision.defaultSelected, false);
  assert.equal(polymarketConnectivity.decision.defaultSelected, true);
  assert.equal(polymarketSigner.decision.defaultSelected, false);
  assert.deepEqual(review.writesEnv, []);
  assert.match(review.description, /redacted change set/i);
  assert.equal(plan.steps[6].fields[0].envKey, 'PANDORA_RESOLUTION_SOURCES');
});

test('setup planning surface distinguishes live-hedge-daemon from mirror sync setup', () => {
  const plan = buildSetupPlan({
    goal: 'live-hedge-daemon',
    currentEnv: {
      CHAIN_ID: '1',
      RPC_URL: 'https://rpc.example.org',
      ORACLE: '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442',
      FACTORY: '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
  });

  assert.equal(plan.goal, 'live-hedge-daemon');
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'runtime-basics',
    'pandora-signer',
    'polymarket-connectivity',
    'polymarket-signer',
    'polymarket-api',
    'hedge-daemon-policy',
    'hosting',
    'review',
  ]);
  assert.equal(plan.steps.some((step) => step.id === 'sports-odds'), false);
  assert.equal(plan.steps.some((step) => step.id === 'resolution-sources'), false);
  assert.equal(plan.steps.find((step) => step.id === 'hosting').decision.defaultSelected, true);
  assert.match(plan.description, /packaged LP hedge daemon/i);
  assert.equal(plan.notes.some((note) => /mirror hedge/i.test(String(note))), true);
  assert.equal(plan.notes.some((note) => /DigitalOcean|generic VPS|Cloudflare Workers/i.test(String(note))), true);
});

setupTest('setup guides first-run users when the starter env still contains placeholder signer material', async () => {
  const tempDir = createTempDir('pandora-setup-guided-');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    const result = await runCliAsync([
      '--output',
      'json',
      'setup',
      '--dotenv-path',
      envPath,
    ]);

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(envPath), true);

    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(Array.isArray(payload.data.guidedNextSteps), true);
    assert.equal(payload.data.guidedNextSteps.some((step) => /market_deployer_a/.test(step)), true);
  } finally {
    removeDir(tempDir);
  }
});

setupTest('setup table output keeps placeholder guidance specific to signer failures', () => {
  const tempDir = createTempDir('pandora-setup-generic-failure-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(examplePath, '# intentionally incomplete\n');

    const result = runCli(['setup', '--goal', 'explore', '--example', examplePath, '--dotenv-path', envPath], {
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(result.status, 1);
    assert.doesNotMatch(result.output, /placeholder signer material/i);
    assert.match(result.output, /Setup incomplete\. Next steps:/);
    assert.match(result.output, /Missing required env var: CHAIN_ID/);
    assert.match(result.output, /Missing required env var: RPC_URL/);
  } finally {
    removeDir(tempDir);
  }
});

setupTest('setup --output json keeps read-only goals free of signer guidance by default', () => {
  const tempDir = createTempDir('pandora-setup-json-explore-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(examplePath, buildValidEnv('https://ethereum.publicnode.com'));

    const result = runCli([
      '--output',
      'json',
      'setup',
      '--goal',
      'explore',
      '--example',
      examplePath,
      '--dotenv-path',
      envPath,
    ], {
      unsetEnvKeys: DOCTOR_ENV_KEYS,
    });

    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.goal, 'explore');
    assert.equal(payload.data.mode, 'manual');
    assert.equal(payload.data.wizard, null);
    assert.equal(payload.data.envStep.status, 'written');
    assert.equal(payload.data.readiness.goal, 'explore');
    assert.equal(payload.data.readiness.status, 'ready');
    assert.equal(Array.isArray(payload.data.guidedNextSteps), true);
    assert.equal(
      payload.data.guidedNextSteps.some((step) => /private key|polymarket/i.test(step)),
      false,
    );
  } finally {
    removeDir(tempDir);
  }
});

test('runCliWithTty translates arrow-key tokens before sending them to the child process', () => {
  const tempDir = createTempDir('pandora-tty-token-probe-');
  const probePath = path.join(tempDir, 'probe.cjs');

  try {
    writeFile(
      probePath,
      [
        "process.stdin.setEncoding('utf8');",
        "let buffer = '';",
        "process.stdout.write('Choose how to proceed');",
        "process.stdin.on('data', (chunk) => {",
        "  buffer += chunk;",
        "  if (buffer.includes('\\u001b[B')) {",
        "    process.stdout.write('ARROW-SEQUENCE-RECEIVED');",
        '    process.exit(0);',
        '  }',
        '});',
        "setTimeout(() => process.exit(2), 2000);",
      ].join('\n'),
    );

    const result = runCliWithTty([], {
      cliPath: probePath,
      timeoutMs: 10_000,
      steps: [
        { expect: 'Choose how to proceed', send: ['arrowDown', 'enter'] },
      ],
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /ARROW-SEQUENCE-RECEIVED/);
  } finally {
    removeDir(tempDir);
  }
});

setupTest('setup --output json exposes the reviewable planning surface for paper-mirror', async () => {
  const tempDir = createTempDir('pandora-setup-json-paper-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');
  const oracleAddress = '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442';
  const factoryAddress = '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c';

  try {
    writeFile(
      examplePath,
      buildValidEnv('https://ethereum.publicnode.com', {
        ORACLE: oracleAddress,
        FACTORY: factoryAddress,
      }),
    );

    const result = runCli([
      '--output',
      'json',
      'setup',
      '--goal',
      'paper-mirror',
      '--example',
      examplePath,
      '--dotenv-path',
      envPath,
    ], {
      unsetEnvKeys: [...DOCTOR_ENV_KEYS, 'PANDORA_RESOLUTION_SOURCES'],
    });

    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.goal, 'paper-mirror');
    assert.equal(payload.data.mode, 'manual');
    assert.equal(payload.data.runtimeInfo.interactive, false);
    assert.equal(payload.data.envStep.status, 'written');
    assert.equal(payload.data.wizard, null);
    assert.equal(payload.data.doctor.journeyReadiness.goal, 'paper-mirror');
    assert.equal(payload.data.readiness.goal, 'paper-mirror');
    assert.equal(Array.isArray(payload.data.guidedNextSteps), true);
    assert.equal(
      payload.data.guidedNextSteps.some((step) => /sources|resolution/i.test(step)),
      true,
    );
    assert.equal(
      payload.data.readiness.recommendations.some((step) => /sources|resolution/i.test(step)),
      true,
    );
  } finally {
    removeDir(tempDir);
  }
});

setupTest('setup --plan exposes packaged hedge-daemon planning without mirror deploy-only steps', async () => {
  const rpcServer = await startRpcMockServer({
    chainIdHex: '0x1',
    codeByAddress: {
      [ADDRESSES.oracle]: '0x6001600101',
      [ADDRESSES.factory]: '0x6002600202',
    },
  });

  const tempDir = createTempDir('pandora-setup-plan-live-hedge-daemon-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(
      examplePath,
      buildValidEnv(rpcServer.url, {
        ORACLE: ADDRESSES.oracle,
        FACTORY: ADDRESSES.factory,
      }),
    );

    const result = await runCliAsync([
      '--output',
      'json',
      'setup',
      '--plan',
      '--goal',
      'live-hedge-daemon',
      '--example',
      examplePath,
      '--dotenv-path',
      envPath,
    ], {
      unsetEnvKeys: [...DOCTOR_ENV_KEYS, 'PANDORA_RESOLUTION_SOURCES'],
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0, result.output);
    const payload = parseJsonOutput(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.goal, 'live-hedge-daemon');
    assert.equal(payload.data.mode, 'plan');
    assert.equal(payload.data.envStep.status, 'no-env');
    assert.equal(payload.data.plan.goal, 'live-hedge-daemon');
    assert.deepEqual(payload.data.plan.steps.map((step) => step.id), [
      'runtime-basics',
      'pandora-signer',
      'polymarket-connectivity',
      'polymarket-signer',
      'polymarket-api',
      'hedge-daemon-policy',
      'hosting',
      'review',
    ]);
    assert.equal(payload.data.plan.steps.some((step) => step.id === 'sports-odds'), false);
    assert.equal(payload.data.plan.steps.some((step) => step.id === 'resolution-sources'), false);
    assert.equal(payload.data.doctor.journeyReadiness.goal, 'live-hedge-daemon');
    assert.equal(
      payload.data.plan.notes.some((note) => /mirror hedge/i.test(String(note))),
      true,
    );
    assert.equal(
      payload.data.plan.notes.some((note) => /DigitalOcean|generic VPS|Cloudflare Workers/i.test(String(note))),
      true,
    );
    assert.equal(fs.existsSync(envPath), false);
  } finally {
    await rpcServer.close();
    removeDir(tempDir);
  }
});

setupTest('setup rejects interactive mode when it cannot acquire a tty', () => {
  const result = runCli(['setup', '--interactive', '--goal', 'deploy']);
  assert.equal(result.status, 1);
  assert.match(result.output, /TTY/i);
  assert.match(result.output, /interactive/i);
});

testInteractiveSetup('setup --interactive supports menu selection through the TTY harness', { timeout: 60_000 }, () => {
  const tempDir = createTempDir('pandora-setup-arrow-keys-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(
      examplePath,
      [
        'CHAIN_ID=1',
        'RPC_URL=https://ethereum.publicnode.com',
      ].join('\n'),
    );

    const result = runCliWithTty(
      [
        'setup',
        '--interactive',
        '--goal',
        'explore',
        '--example',
        examplePath,
        '--dotenv-path',
        envPath,
      ],
      {
        timeoutMs: 60_000,
        env: {
          PANDORA_SETUP_DISABLE_RAW_SELECT: '0',
        },
        stopOnOutput: 'Setup complete.',
        steps: [
          { expect: 'Choose how to proceed', send: ['arrowUp', 'arrowDown', 'enter'] },
        ],
      },
    );

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Choose how to proceed/);
    assert.match(result.output, /Manual scaffold/i);
    assert.match(result.output, /Setup complete\./);
    assert.doesNotMatch(result.output, /Polymarket private key/i);
    assert.doesNotMatch(result.output, /DigitalOcean API token/i);
  } finally {
    removeDir(tempDir);
  }
});

testInteractiveSetup('setup --interactive keeps read-only goals on the manual path without signer prompts', { timeout: 60_000 }, async () => {
  const tempDir = createTempDir('pandora-setup-readonly-manual-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');
  const oracleAddress = '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442';
  const factoryAddress = '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c';

  try {
    writeFile(
      examplePath,
      buildValidEnv('https://ethereum.publicnode.com', {
        ORACLE: oracleAddress,
        FACTORY: factoryAddress,
      }),
    );

    const result = runCliWithTty(
      [
        'setup',
        '--interactive',
        '--goal',
        'explore',
        '--example',
        examplePath,
        '--dotenv-path',
        envPath,
      ],
      {
        timeoutMs: 60_000,
        stopOnOutput: 'Setup complete.',
        steps: [
          { expect: 'Choose how to proceed', send: ['enter'] },
        ],
      },
    );

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Manual mode selected\./);
    assert.doesNotMatch(result.output, /Pandora private key/i);
    assert.doesNotMatch(result.output, /Polymarket private key/i);
    assert.equal(fs.existsSync(envPath), true);
  } finally {
    removeDir(tempDir);
  }
});

testInteractiveSetup('setup --interactive captures mirror connectivity and daemon host settings for paper-mirror', { timeout: 60_000 }, () => {
  const tempDir = createTempDir('pandora-setup-paper-mirror-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(
      examplePath,
      [
        'CHAIN_ID=1',
        'RPC_URL=https://ethereum.publicnode.com',
        'ORACLE=0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442',
        'FACTORY=0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c',
        'USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      ].join('\n'),
    );

    const result = runCliWithTty(
      [
        'setup',
        '--interactive',
        '--force',
        '--goal',
        'paper-mirror',
        '--example',
        examplePath,
        '--dotenv-path',
        envPath,
      ],
      {
        timeoutMs: 60_000,
        stopOnOutput: 'Setup complete.',
        steps: [
          { expect: 'Choose how to proceed', send: '1' },
          { expect: 'Pandora private key', send: '3' },
          { expect: 'Polymarket host [https://clob.polymarket.com]: ', send: '' },
          { expect: 'Polymarket Polygon RPC URL [https://polygon-bor-rpc.publicnode.com]: ', send: '' },
          { expect: 'Polymarket private key', send: '3' },
          { expect: 'Choose a deployment host', send: '3' },
          { expect: 'Sports / Odds provider for mirror discovery', send: '1' },
          { expect: 'Mirror resolution source defaults', send: '1' },
          { expect: 'Primary resolution source URL: ', send: 'https://example.com/a' },
          { expect: 'Secondary resolution source URL: ', send: 'https://example.org/b' },
          { expect: 'Review before write', send: '1' },
        ],
      },
    );

    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /\nReview\n/);
    assert.match(result.output, /Planned changes:/);
    assert.match(result.output, /Setup complete\./);

    const envText = fs.readFileSync(envPath, 'utf8');
    assert.match(envText, /^POLYMARKET_HOST=https:\/\/clob\.polymarket\.com$/m);
    assert.match(envText, /^POLYMARKET_RPC_URL=https:\/\/polygon-bor-rpc\.publicnode\.com$/m);
    assert.match(envText, /^PANDORA_DAEMON_PROVIDER=local$/m);
    assert.doesNotMatch(envText, /^PANDORA_DAEMON_API_TOKEN=/m);
    assert.doesNotMatch(envText, /^PANDORA_DAEMON_API_BASE_URL=/m);
    assert.match(envText, /^PANDORA_RESOLUTION_SOURCES=https:\/\/example\.com\/a,https:\/\/example\.org\/b$/m);
    assert.doesNotMatch(envText, /^POLYMARKET_PRIVATE_KEY=/m);
    assert.doesNotMatch(envText, /^POLYMARKET_FUNDER=/m);
    assert.doesNotMatch(result.output, /Polymarket funder \/ proxy wallet address/i);
    assert.doesNotMatch(envText, /^PRIVATE_KEY=/m);
  } finally {
    removeDir(tempDir);
  }
});

testInteractiveSetup('setup --interactive --force recopies the example template before continuing', { timeout: 60_000 }, () => {
  const tempDir = createTempDir('pandora-setup-interactive-force-');
  const examplePath = path.join(tempDir, 'fixtures', '.env.example');
  const envPath = path.join(tempDir, 'runtime', '.env');

  try {
    writeFile(
      examplePath,
      [
        'CHAIN_ID=1',
        'RPC_URL=https://rpc.example.org',
        'ALPHA=from-example',
      ].join('\n'),
    );
    writeFile(
      envPath,
      [
        'CHAIN_ID=999',
        'RPC_URL=https://stale.example.org',
        'STALE_KEY=keep-me',
      ].join('\n'),
    );

    const result = runCliWithTty(
      [
        'setup',
        '--interactive',
        '--goal',
        'explore',
        '--force',
        '--example',
        examplePath,
        '--dotenv-path',
        envPath,
      ],
      {
        timeoutMs: 60_000,
        stopOnOutput: 'Setup complete.',
        steps: [
          { expect: 'Choose how to proceed', send: '2' },
        ],
      },
    );

    assert.equal(result.timedOut, false);
    assert.equal(fs.existsSync(envPath), true);

    const envText = fs.readFileSync(envPath, 'utf8');
    assert.match(envText, /^ALPHA=from-example$/m);
    assert.doesNotMatch(envText, /^STALE_KEY=keep-me$/m);
    assert.match(envText, /^CHAIN_ID=1$/m);
  } finally {
    removeDir(tempDir);
  }
});

