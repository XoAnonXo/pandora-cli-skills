'use strict';

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunProfileCommand requires deps.${name}()`);
  }
  return deps[name];
}

function renderProfileListTable(payload) {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  for (const item of items) {
    // eslint-disable-next-line no-console
    console.log(
      `${item.id}  ${item.signerBackend}  ${item.readOnly ? 'read-only' : 'mutable'}  ${item.runtimeReady ? 'ready' : (item.resolutionStatus || 'pending')}  ${item.source || '-'}`,
    );
  }
}

function renderProfileGetTable(payload) {
  const profile = payload && payload.profile ? payload.profile : null;
  const resolution = payload && payload.resolution ? payload.resolution : null;
  if (!profile) return;
  // eslint-disable-next-line no-console
  console.log(`${profile.id}  ${profile.signerBackend}  ${profile.readOnly ? 'read-only' : 'mutable'}`);
  if (resolution) {
    // eslint-disable-next-line no-console
    console.log(`resolution=${resolution.status}  ready=${resolution.ready ? 'yes' : 'no'}`);
  }
}

function renderProfileValidateTable(payload) {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  for (const item of items) {
    // eslint-disable-next-line no-console
    console.log(`${item.id}  ${item.signerBackend}  ${item.readOnly ? 'read-only' : 'mutable'}  ${item.runtimeReady ? 'ready' : 'pending'}`);
  }
}

function createRunProfileCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
    const parseProfileFlags = requireDep(deps, 'parseProfileFlags');
    const createProfileStore = requireDep(deps, 'createProfileStore');
    const createProfileResolverService = requireDep(deps, 'createProfileResolverService');

  return async function runProfileCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      const usage = 'pandora [--output table|json] profile list|get|validate [flags]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'list' && includesHelpFlag(actionArgs)) {
      const usage =
        'pandora [--output table|json] profile list [--store-file <path>] [--no-builtins|--builtin-only]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.list.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'get' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] profile get --id <profile-id> [--store-file <path>]';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.get.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    if (action === 'validate' && includesHelpFlag(actionArgs)) {
      const usage = 'pandora [--output table|json] profile validate --file <path>';
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'profile.validate.help', commandHelpPayload(usage));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
      }
      return;
    }

    const options = parseProfileFlags(args, { CliError });
    const store = createProfileStore();
    const resolver = createProfileResolverService({ store });

    if (options.action === 'list') {
      const listing = store.loadProfileSet({
        filePath: options.storeFile,
        includeBuiltIns: options.includeBuiltIns,
        builtinOnly: options.builtinOnly,
      });
      const items = listing.items.map((entry) => {
        const resolved = resolver.resolveProfile({
          profileId: entry.id,
          storeFile: options.storeFile,
          includeSecretMaterial: false,
        });
        return {
          ...entry.summary,
          runtimeReady: Boolean(resolved.resolution && resolved.resolution.ready),
          resolutionStatus: resolved.resolution ? resolved.resolution.status : null,
          backendImplemented: Boolean(resolved.resolution && resolved.resolution.backendImplemented),
        };
      });
      emitSuccess(
        context.outputMode,
        'profile.list',
        {
          profileStoreFile: listing.filePath,
          profileStoreExists: listing.exists,
          builtInCount: listing.builtInCount,
          fileCount: listing.fileCount,
          items,
        },
        renderProfileListTable,
      );
      return;
    }

    if (options.action === 'get') {
      const entry = store.getProfile(options.id, {
        filePath: options.storeFile,
        includeBuiltIns: true,
      });
      if (!entry) {
        throw new CliError('PROFILE_NOT_FOUND', `Profile not found: ${options.id}`, {
          id: options.id,
        });
      }

      const resolved = resolver.resolveProfile({
        profileId: options.id,
        storeFile: options.storeFile,
      });

      emitSuccess(
        context.outputMode,
        'profile.get',
        {
          id: entry.id,
          source: entry.source,
          builtin: entry.builtin,
          filePath: entry.filePath,
          profile: entry.profile,
          summary: entry.summary,
          resolution: resolved.resolution,
        },
        renderProfileGetTable,
      );
      return;
    }

    if (options.action === 'validate') {
      const validation = store.validateProfileFile(options.file);
      const resolutions = validation.profiles.map((profile) =>
        resolver.resolveProfile({
          profileId: profile.id,
          storeFile: validation.filePath,
          includeSecretMaterial: false,
        }).resolution);
      const readyCount = resolutions.filter((resolution) => resolution && resolution.ready === true).length;
      emitSuccess(
        context.outputMode,
        'profile.validate',
        {
          filePath: validation.filePath,
          valid: true,
          runtimeReady: readyCount === validation.profiles.length,
          runtimeReadyCount: readyCount,
          profileCount: validation.profileCount,
          items: validation.items.map((item, index) => ({
            ...item,
            runtimeReady: Boolean(resolutions[index] && resolutions[index].ready),
            resolutionStatus: resolutions[index] ? resolutions[index].status : null,
          })),
          profiles: validation.profiles,
          resolutions,
        },
        renderProfileValidateTable,
      );
      return;
    }

    throw new CliError('INVALID_ARGS', `Unsupported profile subcommand: ${options.action}`);
  };
}

module.exports = {
  createRunProfileCommand,
};
