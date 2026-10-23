# test_reports.py — checks that reports are built from the real analysis numbers (no internet).
# Run with:  python -m pytest

import json

import pytest

import reports
import urban


@pytest.fixture
def data(satellites):
    return urban.analyse_area(3.0, 101.5, 10, "Testville, Selangor, Malaysia")


@pytest.mark.parametrize("template", list(reports.TEMPLATE_TITLES))
def test_every_template_builds_a_ready_report(data, template):
    report = reports.build_report(data, template, metric_names=["Land Surface Temperature", "NDVI Mean Score"])
    json.dumps(report)
    assert report["status"] == "ready" and report["type"] == template
    assert report["title"].startswith(reports.TEMPLATE_TITLES[template]) and report["title"].endswith("Testville")
    assert report["content"]["summary"] and report["content"]["methodology"]
    assert "Landsat 9" in report["dataSource"]


def test_heat_findings_use_the_measured_numbers(data):
    summary = reports.findings(data, "urban-heat", data["zones"])
    assert "Testville" in summary and "Landsat 9 thermal" in summary
    assert data["hotspots"][0]["name"] in summary


def test_selected_zones_and_metrics(data):
    names = [data["zones"][0]["name"], data["zones"][-1]["name"]]
    report = reports.build_report(data, "zone-comparison", zone_names=names,
                                  metric_names=["Cross-Zone Variance", "Historical Trajectory", "Made-up Metric"],
                                  date_range={"start": "2026-01-01", "end": "2026-09-30"})
    assert [z["name"] for z in report["content"]["zones"]] == names
    values = {m["label"]: m["value"] for m in report["content"]["metrics"]}
    assert values["Cross-Zone Variance"].startswith("±")
    assert values["Historical Trajectory"] == "Not available" and values["Made-up Metric"] == "Not available"
    assert "2026-01-01" in report["description"]


def test_every_wizard_and_template_metric_has_a_value(data):
    for name in reports.METRICS:
        value, _ = reports.METRICS[name](data, data["zones"])
        assert isinstance(value, str) and value, name
