import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Plus, Download, Printer, CheckCircle2,
  Calendar, MapPin, Layers, BarChart3, Clock, Search,
  ChevronRight, ArrowLeft, ArrowRight, X, AlertCircle, FileSpreadsheet
} from 'lucide-react';
import { useAppStore } from '@/store';
import { api } from '@/services/api';
import { AreaGate } from '@/components/ui/AreaGate';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn, formatDate, formatTemp } from '@/lib/utils';
import type { AreaData, Report, ReportType } from '@/types';
import toast from 'react-hot-toast';

interface ReportTemplate {
  type: ReportType;
  title: string;
  description: string;
  recommendedFor: string;
  defaultMetrics: string[];
}

const TEMPLATES: ReportTemplate[] = [
  {
    type: 'urban-heat',
    title: 'Urban Heat Island Assessment',
    description: 'Comprehensive analysis of surface temperature distribution, thermal anomalies, and community exposure.',
    recommendedFor: 'City planners & public health directors',
    defaultMetrics: ['Land Surface Temperature', 'Thermal Intensity Index', 'Population Exposure'],
  },
  {
    type: 'vegetation-coverage',
    title: 'Vegetation & Canopy Coverage Report',
    description: 'NDVI vegetation indices, tree canopy coverage, and green infrastructure deficit mapping.',
    recommendedFor: 'Parks & forestry departments',
    defaultMetrics: ['NDVI Mean Score', 'Tree Canopy Coverage %', 'Impervious Surface Ratio'],
  },
  {
    type: 'hotspot-prioritization',
    title: 'Hotspot Prioritization Dossier',
    description: 'Ranked registry of severe thermal clusters with contributing environmental factors and mitigation urgency.',
    recommendedFor: 'Climate resilience taskforces',
    defaultMetrics: ['Priority Ranking', 'Critical Threshold Exceedance', 'Mitigation Feasibility'],
  },
  {
    type: 'greening-opportunity',
    title: 'Urban Greening Opportunity Assessment',
    description: 'Spatial identification of optimal candidate sites for shade structures, pocket parks, and green corridors.',
    recommendedFor: 'Landscape architects & municipal developers',
    defaultMetrics: ['Available Footprint (ha)', 'Cooling Potential Estimate', 'Implementation Ease'],
  },
  {
    type: 'zone-comparison',
    title: 'Multi-Zone Comparative Analysis',
    description: 'Side-by-side benchmarking of temperature, vegetation, and climate vulnerability across townships.',
    recommendedFor: 'Regional policy makers',
    defaultMetrics: ['Cross-Zone Variance', 'Standardized Index Gap', 'Historical Trajectory'],
  },
  {
    type: 'climate-overview',
    title: 'Executive Climate Resilience Summary',
    description: 'High-level synthesis of urban environmental health, key KPIs, and strategic recommendations.',
    recommendedFor: 'Mayoral cabinet & public release',
    defaultMetrics: ['Executive KPIs', 'Risk Heatmap Summary', 'Next Steps'],
  },
];

// Extra metrics the wizard offers on top of each template's own
const EXTRA_METRICS = [
  'Land Surface Temperature (LST) Mean & Maxima',
  'Normalized Difference Vegetation Index (NDVI)',
  'Thermal Heat Exposure Risk Quotient',
  'Impervious Surface & Albedo Factor',
  'Canopy Cover Deficit Against WHO 3-30-300 Target',
  'Tree Planting Feasibility Index',
];

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

export default function ReportsPage() {
  return <AreaGate>{data => <Reports data={data} />}</AreaGate>;
}

function Reports({ data }: { data: AreaData }) {
  const { reports, addReport, area: selection } = useAppStore();
  const { area, zones, provenance } = data;
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'ready' | 'draft'>('all');
  const [selectedReport, setSelectedReport] = useState<Report | null>(reports[0] ?? null);

  // Generation Wizard State
  const topZones = [...zones].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 3).map(z => z.name);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [selectedTemplate, setSelectedTemplate] = useState<ReportTemplate>(TEMPLATES[0]);
  const [selectedLocation, setSelectedLocation] = useState(area.location);
  const [selectedZones, setSelectedZones] = useState<string[]>(topZones);
  const [customDates, setCustomDates] = useState(false);  // off: use the dashboard's latest imagery
  const [dateRange, setDateRange] = useState({ start: isoDaysAgo(365), end: isoDaysAgo(0) });
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(TEMPLATES[0].defaultMetrics);
  const [isGenerating, setIsGenerating] = useState(false);
  const imageryDates = [...provenance.surfaceTemp.dates, ...(provenance.vegetation.kind === 'sentinel2' ? provenance.vegetation.dates : [])].sort();

  const filteredReports = reports.filter(r => {
    if (search && !r.title.toLowerCase().includes(search.toLowerCase()) && !r.description.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (activeTab === 'ready' && r.status !== 'ready') return false;
    if (activeTab === 'draft' && r.status !== 'draft') return false;
    return true;
  });

  const handleStartWizard = (template?: ReportTemplate) => {
    if (template) {
      setSelectedTemplate(template);
      setSelectedMetrics(template.defaultMetrics);
    }
    setWizardStep(1);
    setWizardOpen(true);
  };

  const handleToggleZone = (zoneName: string) => {
    if (selectedZones.includes(zoneName)) {
      if (selectedZones.length > 1) setSelectedZones(selectedZones.filter(z => z !== zoneName));
    } else {
      setSelectedZones([...selectedZones, zoneName]);
    }
  };

  const handleFinishGeneration = async () => {
    if (customDates && dateRange.start > dateRange.end) {
      toast.error('The start date must be before the end date');
      return;
    }
    setIsGenerating(true);
    try {
      const newReport = await api.createReport(selection, {
        template: selectedTemplate.type,
        zones: selectedZones,
        metrics: selectedMetrics,
        dateRange: customDates ? dateRange : undefined,
        reportLocation: selectedLocation,
      });
      addReport(newReport);
      setSelectedReport(newReport);
      setWizardOpen(false);
      toast.success('Climate report compiled successfully!');
    } catch (err) {
      toast.error(`Report failed: ${(err as Error).message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const handleDownloadCSV = (report: Report) => {
    const reportZones = report.content?.zones ?? zones;
    const csv = [
      'Report Title,Location,Generated Date,Status,Data Source',
      [report.title, report.location || area.location, report.createdAt, report.status, report.dataSource].map(quote).join(','),
      '',
      'Zone,Surface Temp (C),Vegetation Cover (%),Priority,Priority Score',
      ...reportZones.map(z => [quote(z.name), z.surfaceTemp ?? '', z.vegetationCoverage, quote(z.severity), z.priorityScore].join(',')),
      ...(report.content?.metrics.length ? ['', 'Metric,Value,Note', ...report.content.metrics.map(m => [m.label, m.value, m.note].map(quote).join(','))] : []),
    ].join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${report.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Downloaded report dataset (CSV)');
  };

  const handlePrintReport = () => {
    window.print();
  };

  return (
    <div className="flex flex-col lg:flex-row h-full overflow-hidden">
      {/* Left List of Reports */}
      <div className="flex-1 flex flex-col overflow-y-auto p-4 lg:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-[var(--text-primary)]">Climate Intelligence Reports</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">
              Generate standardized environmental resilience assessments, hotspot dossiers, and canopy audits for {area.name}.
            </p>
          </div>
          <button
            onClick={() => handleStartWizard()}
            className="btn-primary self-start sm:self-auto text-xs py-2.5 px-4 font-semibold shadow-md flex items-center gap-2"
          >
            <Plus size={16} />
            Create New Report
          </button>
        </div>

        {/* Templates Showcase Carousel */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              Available Report Templates ({TEMPLATES.length})
            </h3>
            <span className="text-[11px] text-[var(--text-muted)]">Click a template to launch generator</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TEMPLATES.map(tpl => (
              <div
                key={tpl.type}
                onClick={() => handleStartWizard(tpl)}
                className="card p-4 hover:border-[var(--accent)] hover:shadow-md cursor-pointer transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--bg-card)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-foreground)] transition-colors">
                      <FileText size={16} />
                    </div>
                    <span className="text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                      {tpl.title}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">
                    {tpl.description}
                  </p>
                </div>
                <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                  <span className="truncate max-w-[170px]">{tpl.recommendedFor}</span>
                  <span className="font-semibold text-[var(--accent-green)] group-hover:underline flex items-center gap-0.5">
                    Launch <ChevronRight size={12} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Search & Tabs */}
        <div className="card p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-[var(--bg-card)] rounded-xl px-3 py-2 border border-[var(--border)]">
            <Search size={15} className="text-[var(--text-muted)] shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search existing reports by title or location…"
              className="bg-transparent text-sm w-full outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            {search && (
              <button onClick={() => setSearch('')}>
                <X size={14} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
              </button>
            )}
          </div>

          <div className="flex p-0.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-xs">
            {(['all', 'ready', 'draft'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-3 py-1.5 rounded-lg font-semibold capitalize transition-all',
                  activeTab === tab
                    ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Report List */}
        <div className="space-y-3">
          {filteredReports.length === 0 && (
            <div className="card">
              <EmptyState
                icon={<FileText size={28} />}
                title={reports.length ? 'No reports match' : 'No reports yet'}
                description={reports.length ? 'Try another search or tab.' : `Launch a template to build a report from the live analysis of ${area.name}.`}
              />
            </div>
          )}
          {filteredReports.map(report => {
            const isSelected = selectedReport?.id === report.id;
            return (
              <div
                key={report.id}
                onClick={() => setSelectedReport(report)}
                className={cn(
                  'card p-4.5 cursor-pointer transition-all border flex flex-col sm:flex-row sm:items-center justify-between gap-3 group',
                  isSelected ? 'border-[var(--accent)] bg-[var(--bg-card)]' : 'hover:border-[var(--accent)]'
                )}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-[var(--accent-green)]" />
                    <h4 className="font-bold text-sm text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                      {report.title}
                    </h4>
                    <span className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                      report.status === 'ready' ? 'badge-low' : 'badge-medium'
                    )}>
                      {report.status}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] max-w-xl">
                    {report.description}
                  </p>
                  <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] pt-1">
                    <span>📅 Created: {formatDate(report.createdAt)}</span>
                    <span>•</span>
                    <span>📍 {report.location || area.location}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownloadCSV(report); }}
                    className="btn-ghost p-2 rounded-xl text-xs flex items-center gap-1.5"
                    title="Export CSV"
                  >
                    <Download size={14} />
                    <span className="hidden md:inline">CSV</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedReport(report); }}
                    className="btn-primary py-1.5 px-3 rounded-xl text-xs font-semibold"
                  >
                    Preview
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Report Preview Drawer */}
      <AnimatePresence>
        {selectedReport && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 420 }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full lg:w-[440px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-sidebar)] flex flex-col justify-between overflow-hidden shadow-2xl"
          >
            <div>
              <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                  <BarChart3 size={15} className="text-[var(--accent-green)]" />
                  Report Document Preview
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handlePrintReport}
                    className="btn-ghost p-1.5 rounded-lg"
                    title="Print / PDF Export"
                  >
                    <Printer size={15} />
                  </button>
                  <button
                    onClick={() => setSelectedReport(null)}
                    className="btn-ghost p-1.5 rounded-lg"
                    aria-label="Close Report Preview"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Rendered Preview Document Body */}
              <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(100vh-180px)] text-xs">
                {/* Document Header */}
                <div className="border-b border-[var(--border)] pb-4 space-y-1.5">
                  <span className="text-[10px] font-bold tracking-widest text-[var(--accent-green)] uppercase">
                    Environmental Intelligence Document
                  </span>
                  <h2 className="text-xl font-black text-[var(--text-primary)] leading-tight">
                    {selectedReport.title}
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Published: {formatDate(selectedReport.createdAt)} • Jurisdiction: {selectedReport.location || area.location}
                    {selectedReport.dateRange && ` • Imagery ${selectedReport.dateRange.start} to ${selectedReport.dateRange.end}`}
                  </p>
                </div>

                {/* Executive Summary */}
                <div className="space-y-1.5">
                  <h4 className="font-bold text-[var(--text-primary)] uppercase text-[11px] tracking-wide">
                    1. Executive Findings
                  </h4>
                  <p className="text-[var(--text-secondary)] leading-relaxed p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    {selectedReport.content?.summary ?? selectedReport.description}
                  </p>
                </div>

                {/* Key Metrics Table */}
                <div className="space-y-1.5">
                  <h4 className="font-bold text-[var(--text-primary)] uppercase text-[11px] tracking-wide">
                    2. Regional Zone Sample
                  </h4>
                  <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[var(--bg-card)] text-[var(--text-muted)] border-b border-[var(--border)]">
                        <tr>
                          <th className="p-2">Zone</th>
                          <th className="p-2">Temp</th>
                          <th className="p-2">Veg %</th>
                          <th className="p-2">Risk</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {(selectedReport.content?.zones ?? []).map(z => (
                          <tr key={z.name}>
                            <td className="p-2 font-semibold text-[var(--text-primary)]">{z.name}</td>
                            <td className="p-2 font-mono text-[var(--alert-high)]">{formatTemp(z.surfaceTemp)}</td>
                            <td className="p-2 font-mono text-[var(--accent-green)]">{z.vegetationCoverage}%</td>
                            <td className="p-2 uppercase font-bold text-[10px]">{z.severity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Analytical metrics chosen in the wizard */}
                {!!selectedReport.content?.metrics.length && (
                  <div className="space-y-1.5">
                    <h4 className="font-bold text-[var(--text-primary)] uppercase text-[11px] tracking-wide">
                      3. Analytical Metrics
                    </h4>
                    <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
                      {selectedReport.content.metrics.map(m => (
                        <div key={m.label} className="p-2.5 space-y-0.5">
                          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{m.label}</p>
                          <p className="font-semibold text-[var(--text-primary)]">{m.value}</p>
                          {m.note && <p className="text-[10px] text-[var(--text-muted)] italic">{m.note}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Methodology & Provenance */}
                <div className="space-y-1.5">
                  <h4 className="font-bold text-[var(--text-primary)] uppercase text-[11px] tracking-wide">
                    {selectedReport.content?.metrics.length ? 4 : 3}. Methodology & Uncertainty
                  </h4>
                  <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-[11px] text-[var(--text-muted)] space-y-1.5 leading-relaxed">
                    <p>• Data source: <strong className="text-[var(--text-secondary)]">{selectedReport.dataSource}</strong></p>
                    {(selectedReport.content?.methodology ?? []).map(line => (
                      <p key={line} className={line.startsWith('Note') || line.startsWith('Screening') ? 'italic text-[var(--alert-medium)] pt-1' : ''}>
                        {line.startsWith('Note') || line.startsWith('Screening') ? `⚠ ${line}` : `• ${line}`}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-sidebar)] flex gap-2">
              <button
                onClick={() => handleDownloadCSV(selectedReport)}
                className="btn-ghost flex-1 justify-center py-2.5 text-xs font-semibold"
              >
                <Download size={14} />
                Download CSV
              </button>
              <button
                onClick={handlePrintReport}
                className="btn-primary flex-1 justify-center py-2.5 text-xs font-semibold shadow-lg"
              >
                <Printer size={14} />
                Print / Save PDF
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Multi-Step Report Generation Wizard Modal */}
      <AnimatePresence>
        {wizardOpen && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="card max-w-2xl w-full p-6 bg-[var(--bg-panel)] border border-[var(--border)] shadow-2xl rounded-2xl flex flex-col justify-between max-h-[90vh] overflow-hidden"
            >
              {/* Wizard Header */}
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    Report Generation Wizard
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Step {wizardStep} of 5: {
                      wizardStep === 1 ? 'Select Report Template' :
                      wizardStep === 2 ? 'Target Jurisdiction & Zones' :
                      wizardStep === 3 ? 'Date Range & Sensor Datasets' :
                      wizardStep === 4 ? 'Select Core Metrics' : 'Preview & Compile'
                    }
                  </p>
                </div>
                <button onClick={() => setWizardOpen(false)} className="btn-ghost p-1.5 rounded-lg">
                  <X size={16} />
                </button>
              </div>

              {/* Wizard Step Body */}
              <div className="py-5 overflow-y-auto text-xs space-y-4">
                {wizardStep === 1 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {TEMPLATES.map(tpl => (
                      <div
                        key={tpl.type}
                        onClick={() => { setSelectedTemplate(tpl); setSelectedMetrics(tpl.defaultMetrics); }}
                        className={cn(
                          'p-4 rounded-xl border cursor-pointer transition-all',
                          selectedTemplate.type === tpl.type
                            ? 'border-[var(--accent)] bg-[var(--bg-card)]'
                            : 'border-[var(--border)] hover:bg-[var(--bg-card)]'
                        )}
                      >
                        <h4 className="font-bold text-sm text-[var(--text-primary)] mb-1">{tpl.title}</h4>
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{tpl.description}</p>
                      </div>
                    ))}
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="space-y-4">
                    <div>
                      <label className="font-semibold text-[var(--text-secondary)] block mb-1">
                        Metropolitan Location
                      </label>
                      <input
                        type="text"
                        value={selectedLocation}
                        onChange={e => setSelectedLocation(e.target.value)}
                        className="input-base"
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-[var(--text-secondary)] block mb-2">
                        Select Monitored Zones to Include ({selectedZones.length} selected)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {zones.map(z => {
                          const isChecked = selectedZones.includes(z.name);
                          return (
                            <div
                              key={z.id}
                              onClick={() => handleToggleZone(z.name)}
                              className={cn(
                                'p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-colors',
                                isChecked ? 'border-[var(--accent)] bg-[var(--bg-card)]' : 'border-[var(--border)]'
                              )}
                            >
                              <span className="font-medium text-[var(--text-primary)]">
                                {z.name}
                                <span className="block text-[10px] font-normal text-[var(--text-muted)]">
                                  {formatTemp(z.surfaceTemp)} · {z.vegetationCoverage}% veg · {z.severity}
                                </span>
                              </span>
                              {isChecked && <CheckCircle2 size={14} className="text-[var(--accent-green)]" />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {wizardStep === 3 && (
                  <div className="space-y-4">
                    <label className="flex items-start gap-2 cursor-pointer p-3 rounded-xl border border-[var(--border)]">
                      <input
                        type="checkbox"
                        checked={!customDates}
                        onChange={e => setCustomDates(!e.target.checked)}
                        className="accent-[var(--accent)] mt-0.5"
                      />
                      <span>
                        <strong className="text-[var(--text-primary)]">Use the dashboard's latest imagery</strong>
                        <span className="block text-[var(--text-muted)]">
                          Scenes from {imageryDates.length ? `${formatDate(imageryDates[0])} to ${formatDate(imageryDates[imageryDates.length - 1])}` : 'the land-cover map'}.
                          Untick to search a custom date range (re-runs the analysis, 10–30 s).
                        </span>
                      </span>
                    </label>
                    <div className={cn('grid grid-cols-2 gap-3', !customDates && 'opacity-50 pointer-events-none')}>
                      <div>
                        <label className="font-semibold text-[var(--text-secondary)] block mb-1">Start Date</label>
                        <input
                          type="date"
                          value={dateRange.start}
                          onChange={e => setDateRange({ ...dateRange, start: e.target.value })}
                          className="input-base"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-[var(--text-secondary)] block mb-1">End Date</label>
                        <input
                          type="date"
                          value={dateRange.end}
                          onChange={e => setDateRange({ ...dateRange, end: e.target.value })}
                          className="input-base"
                        />
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] space-y-2">
                      <p className="font-semibold text-[var(--text-primary)]">Satellite Datasets Used</p>
                      {[provenance.surfaceTemp.sensor, provenance.vegetation.sensor, provenance.landcover, provenance.population].map(source => (
                        <p key={source} className="flex items-center gap-2">
                          <CheckCircle2 size={13} className="text-[var(--accent-green)] shrink-0" />
                          <span>{source}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {wizardStep === 4 && (
                  <div className="space-y-3">
                    <p className="font-semibold text-[var(--text-secondary)]">
                      Select Analytical Metrics for {selectedTemplate.title}
                    </p>
                    <div className="space-y-2">
                      {[...selectedTemplate.defaultMetrics, ...EXTRA_METRICS].map(metric => {
                        const isSelected = selectedMetrics.includes(metric);
                        return (
                          <div
                            key={metric}
                            onClick={() => {
                              if (isSelected) setSelectedMetrics(selectedMetrics.filter(m => m !== metric));
                              else setSelectedMetrics([...selectedMetrics, metric]);
                            }}
                            className={cn(
                              'p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-colors',
                              isSelected ? 'border-[var(--accent)] bg-[var(--bg-card)]' : 'border-[var(--border)]'
                            )}
                          >
                            <span className="font-medium text-[var(--text-primary)]">{metric}</span>
                            {isSelected && <CheckCircle2 size={14} className="text-[var(--accent-green)]" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {wizardStep === 5 && (
                  <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] space-y-3">
                    <h4 className="font-bold text-sm text-[var(--text-primary)]">Report Summary for Compilation</h4>
                    <p>• <strong>Template:</strong> {selectedTemplate.title}</p>
                    <p>• <strong>Region:</strong> {selectedLocation} ({selectedZones.join(', ')})</p>
                    <p>• <strong>Date Range:</strong> {customDates ? `${dateRange.start} to ${dateRange.end}` : "Dashboard's latest imagery"}</p>
                    <p>• <strong>Metrics:</strong> {selectedMetrics.length} selected analytical indices</p>
                    <p className="text-[var(--text-muted)] italic pt-2">
                      Ready to compile document. Generating will build the final report asset available for preview and CSV export.
                    </p>
                  </div>
                )}
              </div>

              {/* Wizard Footer Controls */}
              <div className="pt-4 border-t border-[var(--border)] flex justify-between">
                {wizardStep > 1 ? (
                  <button
                    onClick={() => setWizardStep(s => s - 1)}
                    className="btn-ghost py-2 px-4 flex items-center gap-1.5"
                  >
                    <ArrowLeft size={14} /> Back
                  </button>
                ) : <div />}

                {wizardStep < 5 ? (
                  <button
                    onClick={() => setWizardStep(s => s + 1)}
                    className="btn-primary py-2 px-5 font-semibold flex items-center gap-1.5"
                  >
                    Next Step <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    disabled={isGenerating}
                    onClick={handleFinishGeneration}
                    className="btn-primary py-2 px-6 font-semibold flex items-center gap-2"
                  >
                    {isGenerating ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                        Compiling Document...
                      </span>
                    ) : (
                      'Generate & Publish Report'
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
