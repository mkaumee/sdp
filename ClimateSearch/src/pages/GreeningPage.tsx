import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapContainer, TileLayer, CircleMarker, Popup
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Sprout, Plus, Search, Filter, X, Check, Star, CheckCircle2,
  MapPin, Thermometer, Leaf, ArrowRight, Sparkles, Building2,
  TreePine, AlertCircle, Bookmark, BookmarkCheck, SlidersHorizontal
} from 'lucide-react';
import { useAppStore } from '@/store';
import { demoGreeningCandidates, DEMO_CENTER, DEMO_LABEL } from '@/data/demo';
import { cn, formatDate, getSeverityLabel } from '@/lib/utils';
import type { GreeningCandidate } from '@/types';
import toast from 'react-hot-toast';

export default function GreeningPage() {
  const {
    selectedCandidate, setSelectedCandidate,
    setChatContext, setChatVisible
  } = useAppStore();

  const [candidates, setCandidates] = useState<GreeningCandidate[]>(demoGreeningCandidates);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [shortlist, setShortlist] = useState<string[]>(['g1', 'g3']);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New project modal form state
  const [projectName, setProjectName] = useState('');
  const [targetZone, setTargetZone] = useState('Lagos Island Corridor');
  const [intervention, setIntervention] = useState('Urban Tree Canopy Planting');
  const [notes, setNotes] = useState('');
  const [formErrors, setFormErrors] = useState<{ name?: string }>({});

  const filtered = useMemo(() => {
    return candidates.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.location.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (statusFilter !== 'all' && c.status !== statusFilter) {
        return false;
      }
      if (priorityFilter !== 'all' && c.severity !== priorityFilter) {
        return false;
      }
      return true;
    });
  }, [candidates, search, statusFilter, priorityFilter]);

  const totalArea = candidates.reduce((sum, c) => sum + c.candidateArea, 0).toFixed(1);
  const highPriority = candidates.filter(c => c.severity === 'high').length;
  const underReviewCount = candidates.filter(c => c.status === 'under-review' || c.status === 'identified').length;

  const toggleShortlist = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (shortlist.includes(id)) {
      setShortlist(s => s.filter(x => x !== id));
      toast.success('Removed candidate from shortlist');
    } else {
      setShortlist(s => [...s, id]);
      toast.success('Saved candidate to shortlist');
    }
  };

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      setFormErrors({ name: 'Project name is required' });
      return;
    }

    const newCandidate: GreeningCandidate = {
      id: `g-${Date.now()}`,
      name: projectName,
      location: `${targetZone}, Lagos, Nigeria`,
      coordinates: { lat: 6.45 + (Math.random() - 0.5) * 0.1, lng: 3.40 + (Math.random() - 0.5) * 0.1 },
      currentVegetation: 14,
      surfaceTemp: 35.5,
      priorityScore: 86,
      severity: 'high',
      candidateArea: 4.5,
      reasoning: notes || 'Prioritized community urban greening intervention initiated by city planner.',
      recommendedAction: intervention,
      status: 'under-review',
      dataSource: 'User Created Proposal · ClimateSmart AI',
      lastUpdated: new Date().toISOString().slice(0, 10),
    };

    setCandidates([newCandidate, ...candidates]);
    setSelectedCandidate(newCandidate);
    setShowCreateModal(false);
    setProjectName('');
    setNotes('');
    setFormErrors({});
    toast.success(`Greening project "${projectName}" submitted for review!`);
  };

  const handleAskAssistant = (c: GreeningCandidate) => {
    setChatContext({
      selectedLocation: c.location,
      selectedCandidate: c.name,
      route: '/greening',
    });
    setChatVisible(true);
  };

  return (
    <div className="flex flex-col lg:flex-row h-full overflow-hidden">
      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-[var(--text-primary)]">Greening Opportunities</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">
              Explore candidate locations where additional vegetation may improve urban climate resilience.
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary self-start sm:self-auto text-xs py-2.5 px-4 font-semibold shadow-md flex items-center gap-2"
          >
            <Plus size={16} />
            Propose Greening Project
          </button>
        </div>

        {/* 4 Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-4 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
              <Sprout size={16} className="text-[var(--accent-green)]" /> Candidate Zones
            </div>
            <p className="text-2xl font-black text-[var(--text-primary)] my-1">{candidates.length}</p>
            <span className="text-[10px] text-[var(--text-muted)]">Identified sites</span>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
              <TreePine size={16} className="text-[var(--accent)]" /> Total Candidate Area
            </div>
            <p className="text-2xl font-black text-[var(--accent)] my-1">{totalArea} ha</p>
            <span className="text-[10px] text-[var(--text-muted)]">Estimated footprint</span>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
              <Thermometer size={16} className="text-[var(--alert-high)]" /> High Priority Sites
            </div>
            <p className="text-2xl font-black text-[var(--alert-high)] my-1">{highPriority}</p>
            <span className="text-[10px] text-[var(--text-muted)]">Highest thermal vulnerability</span>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
              <Building2 size={16} className="text-[var(--info)]" /> Under Evaluation
            </div>
            <p className="text-2xl font-black text-[var(--text-primary)] my-1">{underReviewCount}</p>
            <span className="text-[10px] text-[var(--text-muted)]">Pilot proposals in pipeline</span>
          </div>
        </div>

        {/* Opportunity Map */}
        <div className="card overflow-hidden h-72 relative rounded-2xl border border-[var(--border)] shadow-md">
          <MapContainer
            center={[DEMO_CENTER.lat, DEMO_CENTER.lng]}
            zoom={11}
            style={{ height: '100%', width: '100%', background: '#07111F' }}
            scrollWheelZoom={false}
          >
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution='Esri Satellite'
            />
            {candidates.map(gc => (
              <CircleMarker
                key={gc.id}
                center={[gc.coordinates.lat, gc.coordinates.lng]}
                radius={gc.severity === 'high' ? 20 : 15}
                pathOptions={{
                  color: '#B7E65C',
                  fillColor: '#72C85B',
                  fillOpacity: selectedCandidate?.id === gc.id ? 0.9 : 0.6,
                  weight: selectedCandidate?.id === gc.id ? 4 : 2,
                }}
                eventHandlers={{ click: () => setSelectedCandidate(gc) }}
              >
                <Popup>
                  <div className="p-1 font-sans text-slate-900">
                    <p className="font-bold text-sm flex items-center gap-1">
                      <Sprout size={14} className="text-green-600" />
                      {gc.name}
                    </p>
                    <p className="text-xs text-slate-600">{gc.location}</p>
                    <p className="text-xs text-slate-800 mt-1 font-semibold">Area: {gc.candidateArea} ha • Veg: {gc.currentVegetation}%</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
          <div className="absolute top-3 left-3 z-[1000] px-3 py-1 rounded-xl bg-[var(--bg-panel)]/90 backdrop-blur-md border border-[var(--border)] text-xs text-[var(--text-secondary)]">
            Greening candidate markers • Click marker to inspect
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="card p-3.5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-[var(--bg-card)] rounded-xl px-3 py-2 border border-[var(--border)]">
            <Search size={15} className="text-[var(--text-muted)] shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search candidate zones or interventions…"
              className="bg-transparent text-sm w-full outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            {search && (
              <button onClick={() => setSearch('')}>
                <X size={14} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--text-muted)] font-semibold">Status:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="identified">Identified</option>
              <option value="under-review">Under Review</option>
              <option value="approved">Approved</option>
              <option value="in-progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--text-muted)] font-semibold">Priority:</span>
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none"
            >
              <option value="all">All Priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        {/* Candidate Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(candidate => {
            const isShortlisted = shortlist.includes(candidate.id);
            const isSelected = selectedCandidate?.id === candidate.id;

            return (
              <motion.div
                key={candidate.id}
                onClick={() => setSelectedCandidate(candidate)}
                className={cn(
                  'card p-5 cursor-pointer transition-all border flex flex-col justify-between gap-3 group hover:shadow-lg',
                  isSelected ? 'border-[var(--accent)] bg-[var(--bg-card)]' : 'hover:border-[var(--accent)]'
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-base text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                          {candidate.name}
                        </h3>
                        <span className={cn(
                          'px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                          candidate.severity === 'high' ? 'badge-high' : candidate.severity === 'medium' ? 'badge-medium' : 'badge-low'
                        )}>
                          {candidate.severity}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 font-mono">
                        <MapPin size={12} className="text-[var(--accent)]" /> {candidate.location}
                      </p>
                    </div>

                    <button
                      onClick={(e) => toggleShortlist(candidate.id, e)}
                      className={cn(
                        'p-2 rounded-xl border transition-colors',
                        isShortlisted
                          ? 'bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]'
                          : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      )}
                      title={isShortlisted ? 'Shortlisted' : 'Save to shortlist'}
                    >
                      <Bookmark size={14} className={isShortlisted ? 'fill-current' : ''} />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 my-3 text-xs">
                    <div className="p-2 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
                      <span className="text-[10px] text-[var(--text-muted)] block">Veg Cover</span>
                      <strong className="text-[var(--accent-green)] font-mono">{candidate.currentVegetation}%</strong>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
                      <span className="text-[10px] text-[var(--text-muted)] block">Surface Temp</span>
                      <strong className="text-[var(--alert-high)] font-mono">{candidate.surfaceTemp}°C</strong>
                    </div>
                    <div className="p-2 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
                      <span className="text-[10px] text-[var(--text-muted)] block">Area</span>
                      <strong className="text-[var(--text-primary)] font-mono">{candidate.candidateArea} ha</strong>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <p className="text-[var(--text-secondary)] line-clamp-2">
                      <strong className="text-[var(--text-primary)]">Why: </strong>
                      {candidate.reasoning}
                    </p>
                    <p className="text-[var(--text-muted)] flex items-center gap-1">
                      <strong className="text-[var(--text-secondary)]">Action: </strong>
                      <span className="truncate">{candidate.recommendedAction}</span>
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between text-xs">
                  <span className={cn(
                    'px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize',
                    candidate.status === 'approved' ? 'badge-low' :
                    candidate.status === 'in-progress' ? 'badge-info' : 'badge-medium'
                  )}>
                    {candidate.status.replace('-', ' ')}
                  </span>

                  <span className="text-xs font-semibold text-[var(--accent-green)] group-hover:underline flex items-center gap-1">
                    Inspect Opportunity <ArrowRight size={13} />
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Candidate Detail Drawer (Right side) */}
      <AnimatePresence>
        {selectedCandidate && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 380 }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full lg:w-96 shrink-0 border-l border-[var(--border)] bg-[var(--bg-sidebar)] flex flex-col justify-between overflow-hidden shadow-2xl"
          >
            <div>
              <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Sprout size={15} className="text-[var(--accent-green)]" />
                  Opportunity Dossier
                </span>
                <button
                  onClick={() => setSelectedCandidate(null)}
                  className="btn-ghost p-1 rounded-lg"
                  aria-label="Close Candidate Details"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(100vh-210px)]">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black text-[var(--text-primary)]">{selectedCandidate.name}</h3>
                    <span className={cn(
                      'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase',
                      selectedCandidate.severity === 'high' ? 'badge-high' : selectedCandidate.severity === 'medium' ? 'badge-medium' : 'badge-low'
                    )}>
                      {selectedCandidate.severity}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-1 font-mono">
                    <MapPin size={12} className="text-[var(--accent)]" /> {selectedCandidate.location}
                  </p>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide block">Priority Score</span>
                    <span className="text-2xl font-black text-[var(--text-primary)]">{selectedCandidate.priorityScore}/100</span>
                  </div>
                  <div className="card p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide block">Candidate Area</span>
                    <span className="text-2xl font-black text-[var(--accent)]">{selectedCandidate.candidateArea} ha</span>
                  </div>
                </div>

                {/* Why prioritized */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Site Selection Rationale
                  </h4>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                    {selectedCandidate.reasoning}
                  </p>
                </div>

                {/* Recommended Interventions */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Recommended Interventions
                  </h4>
                  <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] space-y-2 text-xs text-[var(--text-secondary)]">
                    <div className="flex items-start gap-2">
                      <span className="text-[var(--accent-green)] font-bold">✓</span>
                      <span>{selectedCandidate.recommendedAction}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[var(--accent-green)] font-bold">✓</span>
                      <span>Permeable pavement & rain garden bioswales along access paths</span>
                    </div>
                  </div>
                </div>

                {/* Data disclaimer */}
                <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-[11px] text-[var(--text-muted)] space-y-1">
                  <p>Status: <strong className="text-[var(--text-secondary)] capitalize">{selectedCandidate.status.replace('-', ' ')}</strong></p>
                  <p className="italic text-[var(--alert-medium)] pt-0.5">
                    ⚠ Environmental benefit calculations represent estimated potential under standard canopy models. Ground-truthing required.
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom action */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-sidebar)]">
              <button
                onClick={() => handleAskAssistant(selectedCandidate)}
                className="btn-primary w-full justify-center py-2.5 text-xs font-semibold shadow-lg"
              >
                <Sparkles size={15} />
                Ask Assistant About This Site
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Propose Greening Project Modal Dialog */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="card max-w-lg w-full p-6 bg-[var(--bg-panel)] border border-[var(--border)] shadow-2xl rounded-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Sprout size={18} className="text-[var(--accent-green)]" />
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    Propose Greening Project
                  </h3>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="btn-ghost p-1.5 rounded-lg"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateProject} className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-[var(--text-secondary)] block mb-1">
                    Project Initiative Name *
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={e => { setProjectName(e.target.value); setFormErrors({}); }}
                    placeholder="e.g. Lagos Marina Shaded Promenade"
                    className="input-base"
                  />
                  {formErrors.name && (
                    <p className="text-red-500 text-[11px] mt-1">{formErrors.name}</p>
                  )}
                </div>

                <div>
                  <label className="font-semibold text-[var(--text-secondary)] block mb-1">
                    Target Zone / Township
                  </label>
                  <select
                    value={targetZone}
                    onChange={e => setTargetZone(e.target.value)}
                    className="input-base"
                  >
                    <option value="Lagos Island Corridor">Lagos Island Corridor</option>
                    <option value="Ikeja Industrial Zone">Ikeja Industrial Zone</option>
                    <option value="Victoria Island District">Victoria Island District</option>
                    <option value="Surulere Residential">Surulere Residential</option>
                    <option value="Agege Market Sector">Agege Market Sector</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-[var(--text-secondary)] block mb-1">
                    Proposed Intervention Type
                  </label>
                  <select
                    value={intervention}
                    onChange={e => setIntervention(e.target.value)}
                    className="input-base"
                  >
                    <option value="Urban Tree Canopy Planting">Urban Tree Canopy Planting</option>
                    <option value="Green Corridor & Bioswales">Green Corridor & Bioswales</option>
                    <option value="Commercial Rooftop Greening">Commercial Rooftop Greening</option>
                    <option value="Pocket Park & Shade Structure">Pocket Park & Shade Structure</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-[var(--text-secondary)] block mb-1">
                    Project Justification & Notes
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Describe environmental justification, community stakeholders, and priority reasons..."
                    className="input-base resize-none"
                  />
                </div>

                <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="btn-ghost py-2 px-4"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary py-2 px-5 font-semibold"
                  >
                    Submit Proposal
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
