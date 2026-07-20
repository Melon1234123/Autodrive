import pytest
from pydantic import ValidationError

import autodrive_harness.models as models
from autodrive_harness.report_v2 import GenerationMetadata


def test_v1_report_models_are_removed_after_v2_migration():
    assert not hasattr(models, "DiagnosisReport")
    assert not hasattr(models, "AnalysisSection")


def test_v2_generation_metadata_is_strict_and_records_local_fallbacks():
    metadata = GenerationMetadata.local(model=None, reason="disabled")

    assert metadata.mode == "local-harness"
    assert metadata.attempted is False
    with pytest.raises(ValidationError):
        GenerationMetadata.model_validate({
            **metadata.model_dump(mode="json"),
            "unexpected": "v1-field",
        })
