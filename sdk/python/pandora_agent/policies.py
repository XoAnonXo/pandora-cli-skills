from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .catalog import load_generated_contract_registry
from .errors import PandoraSdkError

_DERIVED_FAMILY_SELECTORS = {
    'policyPacks': ('commandsWithPolicyScopes',),
    'signerProfiles': ('commandsRequiringSecrets',),
}

_EXPLICIT_SELECTOR_FIELDS = frozenset({
    'commandsWithPolicyScopes',
    'commandsRequiringSecrets',
})


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _as_string_tuple(value: Any) -> Tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(str(item) for item in value)


def _sorted_command_tuple(values: List[str]) -> Tuple[str, ...]:
    seen = set()
    ordered: List[str] = []
    for item in sorted(str(value) for value in values):
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return tuple(ordered)


def _merge_string_tuples(primary: Tuple[str, ...], secondary: Tuple[str, ...]) -> Tuple[str, ...]:
    ordered: List[str] = []
    seen = set()
    for item in (*primary, *secondary):
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return tuple(ordered)


@dataclass(frozen=True)
class PolicyProfileFamily:
    name: str
    status: Optional[str]
    supported: Optional[bool]
    notes: Tuple[str, ...]
    selectors: Dict[str, Tuple[str, ...]]
    raw: Dict[str, Any]

    @classmethod
    def from_raw(cls, name: str, payload: Mapping[str, Any]) -> 'PolicyProfileFamily':
        selectors: Dict[str, Tuple[str, ...]] = {}
        for key, value in payload.items():
            if key == 'notes' or key not in _EXPLICIT_SELECTOR_FIELDS:
                continue
            if isinstance(value, list):
                selectors[str(key)] = _as_string_tuple(value)
        return cls(
            name=str(name),
            status=str(payload['status']) if isinstance(payload.get('status'), str) else None,
            supported=payload.get('supported') if isinstance(payload.get('supported'), bool) else None,
            notes=_as_string_tuple(payload.get('notes')),
            selectors=selectors,
            raw=dict(payload),
        )

    @property
    def selector_names(self) -> Tuple[str, ...]:
        return tuple(self.selectors.keys())

    @property
    def member_commands(self) -> Tuple[str, ...]:
        ordered: List[str] = []
        seen = set()
        for values in self.selectors.values():
            for command_name in values:
                if command_name in seen:
                    continue
                seen.add(command_name)
                ordered.append(command_name)
        return tuple(ordered)

    def get_selector(self, selector_name: str) -> Tuple[str, ...]:
        return tuple(self.selectors.get(str(selector_name), ()))

    def matching_selectors(self, command_name: str) -> Tuple[str, ...]:
        normalized = str(command_name).strip()
        return tuple(
            selector_name
            for selector_name, values in self.selectors.items()
            if normalized in values
        )

    def includes_command(self, command_name: str) -> bool:
        return bool(self.matching_selectors(command_name))


@dataclass(frozen=True)
class CommandPolicyInspection:
    command_name: str
    summary: Optional[str]
    policy_scopes: Tuple[str, ...]
    requires_secrets: bool
    supports_remote: Optional[bool]
    remote_eligible: Optional[bool]
    mcp_mutating: Optional[bool]
    job_capable: Optional[bool]
    matching_profiles: Dict[str, Tuple[str, ...]]
    raw_digest: Dict[str, Any]

    @property
    def has_policy_scopes(self) -> bool:
        return bool(self.policy_scopes)

    @property
    def profile_names(self) -> Tuple[str, ...]:
        return tuple(self.matching_profiles.keys())


class PolicyProfiles:
    def __init__(self, registry: Mapping[str, Any]):
        self._registry = dict(registry)
        self._capabilities = _as_dict(self._registry.get('capabilities'))
        self._command_digests = _as_dict(self._capabilities.get('commandDigests'))
        raw_profiles = _as_dict(self._capabilities.get('policyProfiles'))
        derived_selectors = {
            'policyPacks': {
                'commandsWithPolicyScopes': self.commands_with_scopes(),
            },
            'signerProfiles': {
                'commandsRequiringSecrets': self.commands_requiring_secrets(),
            },
        }
        self._families: Dict[str, PolicyProfileFamily] = {
            name: PolicyProfileFamily.from_raw(
                name,
                self._merge_selector_payload(dict(payload), derived_selectors.get(str(name), {})),
            )
            for name, payload in raw_profiles.items()
            if isinstance(payload, Mapping)
        }

    @staticmethod
    def _merge_selector_payload(
        payload: Dict[str, Any],
        derived_selectors: Mapping[str, Tuple[str, ...]],
    ) -> Dict[str, Any]:
        merged = dict(payload)
        for selector_name, derived_values in derived_selectors.items():
            explicit_values = _as_string_tuple(merged.get(selector_name))
            combined_values = _merge_string_tuples(explicit_values, derived_values)
            if combined_values:
                merged[selector_name] = list(combined_values)
        return merged

    @classmethod
    def from_contract_registry(cls, registry: Mapping[str, Any]) -> 'PolicyProfiles':
        return cls(registry)

    def to_dict(self) -> Dict[str, Any]:
        return _as_dict(self._capabilities.get('policyProfiles'))

    def family_names(self) -> Tuple[str, ...]:
        return tuple(sorted(self._families.keys()))

    def list_families(self) -> List[PolicyProfileFamily]:
        return [self._families[name] for name in self.family_names()]

    def get_family(self, name: str) -> Optional[PolicyProfileFamily]:
        return self._families.get(str(name).strip())

    def require_family(self, name: str) -> PolicyProfileFamily:
        family = self.get_family(name)
        if family is None:
            raise PandoraSdkError('PANDORA_SDK_UNKNOWN_POLICY_PROFILE', f'Unknown Pandora policy/profile family: {name}')
        return family

    def commands_for_family(self, family_name: str, selector_name: Optional[str] = None) -> Tuple[str, ...]:
        family = self.require_family(family_name)
        if selector_name is not None:
            return family.get_selector(selector_name)
        return family.member_commands

    def commands_with_scopes(self) -> Tuple[str, ...]:
        commands: List[str] = []
        for command_name, digest in sorted(self._command_digests.items()):
            if not isinstance(digest, Mapping):
                continue
            scopes = digest.get('policyScopes')
            if isinstance(scopes, list) and scopes:
                commands.append(str(command_name))
        return _sorted_command_tuple(commands)

    def commands_requiring_secrets(self) -> Tuple[str, ...]:
        commands: List[str] = []
        for command_name, digest in sorted(self._command_digests.items()):
            if not isinstance(digest, Mapping):
                continue
            if bool(digest.get('requiresSecrets')):
                commands.append(str(command_name))
        return _sorted_command_tuple(commands)

    def inspect_command(self, command_name: str) -> CommandPolicyInspection:
        normalized = str(command_name).strip()
        digest = self._command_digests.get(normalized)
        if not isinstance(digest, Mapping):
            raise PandoraSdkError('PANDORA_SDK_UNKNOWN_COMMAND', f'Unknown Pandora command digest: {command_name}')

        matching_profiles: Dict[str, Tuple[str, ...]] = {}
        for family in self._families.values():
            selectors = family.matching_selectors(normalized)
            if not selectors and family.name == 'policyPacks' and digest.get('policyScopes'):
                selectors = _DERIVED_FAMILY_SELECTORS['policyPacks']
            if not selectors and family.name == 'signerProfiles' and bool(digest.get('requiresSecrets')):
                selectors = _DERIVED_FAMILY_SELECTORS['signerProfiles']
            if selectors:
                matching_profiles[family.name] = tuple(selectors)

        return CommandPolicyInspection(
            command_name=normalized,
            summary=str(digest['summary']) if isinstance(digest.get('summary'), str) else None,
            policy_scopes=_as_string_tuple(digest.get('policyScopes')),
            requires_secrets=bool(digest.get('requiresSecrets')),
            supports_remote=digest.get('supportsRemote') if isinstance(digest.get('supportsRemote'), bool) else None,
            remote_eligible=digest.get('remoteEligible') if isinstance(digest.get('remoteEligible'), bool) else None,
            mcp_mutating=digest.get('mcpMutating') if isinstance(digest.get('mcpMutating'), bool) else None,
            job_capable=digest.get('jobCapable') if isinstance(digest.get('jobCapable'), bool) else None,
            matching_profiles=matching_profiles,
            raw_digest=dict(digest),
        )


def load_generated_policy_profiles() -> PolicyProfiles:
    return PolicyProfiles.from_contract_registry(load_generated_contract_registry())


def inspect_generated_command_policy(command_name: str) -> CommandPolicyInspection:
    return load_generated_policy_profiles().inspect_command(command_name)
