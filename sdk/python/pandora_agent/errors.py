from __future__ import annotations

from typing import Any, Dict, Optional


class PandoraSdkError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Any] = None):
        super().__init__(message)
        self.code = str(code)
        self.details = details

    def to_dict(self) -> Dict[str, Any]:
        return {
            'code': self.code,
            'message': str(self),
            'details': self.details,
        }

    def __repr__(self) -> str:
        return f'{self.__class__.__name__}(code={self.code!r}, message={str(self)!r}, details={self.details!r})'


class PandoraToolCallError(PandoraSdkError):
    def __init__(
        self,
        code: str,
        message: str,
        details: Optional[Any] = None,
        *,
        envelope: Optional[Dict[str, Any]] = None,
        result: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(code, message, details)
        self.envelope = envelope
        self.result = result

    def to_dict(self) -> Dict[str, Any]:
        payload = super().to_dict()
        payload['envelope'] = self.envelope
        payload['result'] = self.result
        return payload
