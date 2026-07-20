import autodrive_harness.enhancement as enhancement
import autodrive_harness.narrative as narrative


def test_deprecated_enhancement_plan_is_removed_after_server_migration():
    assert not hasattr(enhancement, "EnhancementPlan")


def test_enhancement_module_reexports_grounded_narrative_boundary():
    assert enhancement.compose_report is narrative.compose_report
    assert enhancement.NarrativeComposer is narrative.NarrativeComposer
    assert enhancement.NarrativeFailure is narrative.NarrativeFailure
