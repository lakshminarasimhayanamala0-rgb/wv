// ExamSlot - Main Application Controller & State Orchestrator
const { createElement: h, useState, useMemo, useEffect } = React;

import { INITIAL_SUBJECTS, INITIAL_STUDENTS, DEFAULT_EXAM_SETTINGS, DATASET_VERSION, DEFAULT_LIVE_SHEET_URL } from './sampleData.js';
import { buildConflictGraph } from './conflictDetector.js';
import { runWelshPowell, runGreedyColoring, runBacktrackingColoring, calculateGraphMetrics } from './graphAlgorithms.js';
import { generateTimetable } from './timetableGenerator.js';
import { exportTimetableToPDF } from './pdfExport.js';
import { extractGoogleSheetCsvUrl, fetchGoogleSheetCSV, parseCSV, validateImportedData } from './csvHelper.js';

import { Navbar } from './components/Navbar.js';
import { Sidebar } from './components/Sidebar.js';
import { DashboardView } from './components/DashboardView.js';
import { StudentsView } from './components/StudentsView.js';
import { SubjectsView } from './components/SubjectsView.js';
import { ImportView } from './components/ImportView.js';
import { LiveFormView } from './components/LiveFormView.js';
import { ConflictView } from './components/ConflictView.js';
import { GraphView } from './components/GraphView.js';
import { AlgorithmsView } from './components/AlgorithmsView.js';
import { TimetableView } from './components/TimetableView.js';
import { AnalysisView } from './components/AnalysisView.js';
import { AboutView } from './components/AboutView.js';

export function App() {
  // 1. Data State with LocalStorage Persistence & Version Check
  const [subjects, setSubjects] = useState(() => {
    try {
      const savedVersion = localStorage.getItem('examslot_version');
      if (savedVersion !== DATASET_VERSION) {
        localStorage.setItem('examslot_version', DATASET_VERSION);
        localStorage.setItem('examslot_subjects', JSON.stringify(INITIAL_SUBJECTS));
        localStorage.setItem('examslot_students', JSON.stringify(INITIAL_STUDENTS));
        return INITIAL_SUBJECTS;
      }
      const saved = localStorage.getItem('examslot_subjects');
      return saved ? JSON.parse(saved) : INITIAL_SUBJECTS;
    } catch (e) {
      return INITIAL_SUBJECTS;
    }
  });

  const [students, setStudents] = useState(() => {
    try {
      const savedVersion = localStorage.getItem('examslot_version');
      if (savedVersion !== DATASET_VERSION) {
        return INITIAL_STUDENTS;
      }
      const saved = localStorage.getItem('examslot_students');
      return saved ? JSON.parse(saved) : INITIAL_STUDENTS;
    } catch (e) {
      return INITIAL_STUDENTS;
    }
  });

  const [examSettings, setExamSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('examslot_settings');
      return saved ? JSON.parse(saved) : DEFAULT_EXAM_SETTINGS;
    } catch (e) {
      return DEFAULT_EXAM_SETTINGS;
    }
  });

  // Google Forms Live Sync State
  const [liveSheetUrl, setLiveSheetUrl] = useState(() => {
    try {
      return localStorage.getItem('examslot_live_sheet_url') || DEFAULT_LIVE_SHEET_URL;
    } catch (e) {
      return DEFAULT_LIVE_SHEET_URL;
    }
  });
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [isSimulatingStream, setIsSimulatingStream] = useState(false);
  const [liveToast, setLiveToast] = useState(null);

  // Navigation and Algorithm Selection
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeAlgorithm, setActiveAlgorithm] = useState('welsh-powell');
  const [manualColoring, setManualColoring] = useState(null);

  // Sync to LocalStorage
  useEffect(() => {
    localStorage.setItem('examslot_subjects', JSON.stringify(subjects));
  }, [subjects]);

  useEffect(() => {
    localStorage.setItem('examslot_students', JSON.stringify(students));
  }, [students]);

  useEffect(() => {
    localStorage.setItem('examslot_settings', JSON.stringify(examSettings));
  }, [examSettings]);

  useEffect(() => {
    if (liveSheetUrl) {
      localStorage.setItem('examslot_live_sheet_url', liveSheetUrl);
    }
  }, [liveSheetUrl]);

  // Live Sync Fetcher
  const handleSyncFromGoogleSheet = async (customUrl) => {
    const targetUrl = customUrl || liveSheetUrl;
    if (!targetUrl) {
      alert('Please enter or paste your linked Google Sheet URL.');
      return;
    }

    setIsLiveSyncing(true);
    try {
      const csvText = await fetchGoogleSheetCSV(targetUrl);
      const rows = parseCSV(csvText);
      const validation = validateImportedData(rows, subjects, students);

      if (!validation.isValid) {
        alert(`Validation Notice: ${validation.error}`);
      } else {
        const validRecords = validation.records
          .filter((r) => r.isValid)
          .map((r) => ({
            id: r.id,
            name: r.name,
            department: r.department,
            semester: r.semester,
            academicYear: r.academicYear,
            subjects: r.subjects
          }));

        if (validRecords.length > 0) {
          setStudents(validRecords);
          setManualColoring(null);
          const syncTime = new Date().toLocaleTimeString();
          setLastSyncTime(syncTime);
          alert(`✓ Live Sync Successful!\nLoaded ${validRecords.length} registered student responses from Google Sheets.\nConflict graph and timetables updated in real time.`);
        } else {
          alert('No valid student response records were found in the sheet. Please make sure students have submitted responses.');
        }
      }
    } catch (err) {
      console.warn('Google Sheet Sync Notice:', err);
      // Clean up prefix flags if present
      let displayMsg = err.message || 'An error occurred while fetching.';
      displayMsg = displayMsg.replace(/^(NOTICE_GOOGLE_FORM|RESTRICTED_ACCESS|COULD_NOT_CONNECT):\s*/, '');
      alert(displayMsg);
    } finally {
      setIsLiveSyncing(false);
    }
  };

  // Periodic Auto-Sync Timer
  useEffect(() => {
    let timer = null;
    if (autoSyncEnabled && liveSheetUrl) {
      timer = setInterval(() => {
        handleSyncFromGoogleSheet(liveSheetUrl);
      }, 15000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [autoSyncEnabled, liveSheetUrl, subjects]);

  // Live Auto-Stream Simulation Timer
  useEffect(() => {
    let timer = null;
    if (isSimulatingStream) {
      const names = [
        'Aarav Sharma', 'Priya Patel', 'Rohan Verma', 'Sneha Reddy', 'Vikram Singh',
        'Ananya Iyer', 'Rahul Nair', 'Pooja Gupta', 'Aditya Joshi', 'Kavya Menon',
        'Siddharth Rao', 'Neha Kulkarni', 'Karthik Bhat', 'Divya Pillai', 'Varun Deshmukh',
        'Riya Sen', 'Manish Pandey', 'Tanvi Shah', 'Arjun Mehta', 'Ishita Bose'
      ];
      const depts = ['Computer Science', 'Information Technology', 'AI & Data Science'];

      timer = setInterval(() => {
        setStudents((prev) => {
          const nextId = `STU${String(prev.length + 1).padStart(3, '0')}`;
          const randName = names[Math.floor(Math.random() * names.length)];
          const randDept = depts[Math.floor(Math.random() * depts.length)];
          const shuffled = [...subjects].sort(() => 0.5 - Math.random());
          const count = Math.floor(Math.random() * 3) + 2; // 2 to 4 courses
          const chosen = shuffled.slice(0, count).map((s) => s.code);

          const newStudent = {
            id: nextId,
            name: `${randName} (Stream)`,
            department: randDept,
            semester: 'Sem 4',
            academicYear: '2026-2027',
            subjects: chosen
          };

          setLiveToast(`🔔 Live Student Registration: ${newStudent.name} (${nextId}) registered for [${chosen.join(', ')}]. Graph & Timetable updated!`);
          return [...prev, newStudent];
        });
      }, 5000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isSimulatingStream, subjects]);

  // Auto-dismiss live toast after 4s
  useEffect(() => {
    if (liveToast) {
      const t = setTimeout(() => setLiveToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [liveToast]);

  // 2. Dynamic Graph & Algorithms Computation
  // Automatically updates on ANY student or subject registration changes!
  const conflictGraph = useMemo(() => {
    return buildConflictGraph(subjects, students);
  }, [subjects, students]);

  const allResults = useMemo(() => {
    const wp = runWelshPowell(conflictGraph);
    const gr = runGreedyColoring(conflictGraph);
    const bt = runBacktrackingColoring(conflictGraph);
    return { welshPowell: wp, greedy: gr, backtracking: bt };
  }, [conflictGraph]);

  const activeResult = useMemo(() => {
    if (activeAlgorithm === 'greedy') return allResults.greedy;
    if (activeAlgorithm === 'backtracking') return allResults.backtracking;
    return allResults.welshPowell;
  }, [activeAlgorithm, allResults]);

  // Effective Coloring (manual overrides take precedence if set)
  const effectiveColoring = useMemo(() => {
    if (manualColoring) {
      // Ensure all current subjects have a color
      const merged = { ...activeResult.coloring, ...manualColoring };
      return merged;
    }
    return activeResult.coloring;
  }, [manualColoring, activeResult]);

  // Timetable computation
  const timetable = useMemo(() => {
    return generateTimetable(effectiveColoring, conflictGraph, examSettings);
  }, [effectiveColoring, conflictGraph, examSettings]);

  // Graph Metrics computation
  const metrics = useMemo(() => {
    return calculateGraphMetrics(conflictGraph);
  }, [conflictGraph]);

  // 3. Handlers
  const handleAddStudent = (newStudent) => {
    setStudents((prev) => [newStudent, ...prev]);
    setManualColoring(null);
  };

  const handleUpdateStudent = (id, updated) => {
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    setManualColoring(null);
  };

  const handleDeleteStudent = (id) => {
    setStudents((prev) => prev.filter((s) => s.id !== id));
    setManualColoring(null);
  };

  const handleAddSubject = (newSubject) => {
    setSubjects((prev) => [...prev, newSubject]);
    setManualColoring(null);
  };

  const handleUpdateSubject = (code, updated) => {
    setSubjects((prev) => prev.map((s) => (s.code === code ? { ...s, ...updated } : s)));
  };

  const handleDeleteSubject = (code) => {
    setSubjects((prev) => prev.filter((s) => s.code !== code));
    // Clean up student registrations
    setStudents((prev) =>
      prev.map((st) => ({
        ...st,
        subjects: (st.subjects || []).filter((c) => c !== code)
      }))
    );
    setManualColoring(null);
  };

  const handleCommitImport = (newStudents, mode) => {
    if (mode === 'replace') {
      setStudents(newStudents);
    } else {
      // Merge by student ID
      const studentMap = new Map();
      students.forEach((s) => studentMap.set(s.id.toUpperCase(), s));
      newStudents.forEach((s) => studentMap.set(s.id.toUpperCase(), s));
      setStudents(Array.from(studentMap.values()));
    }
    setManualColoring(null);
  };

  const handleRestoreDefaults = () => {
    setSubjects(INITIAL_SUBJECTS);
    setStudents(INITIAL_STUDENTS);
    setExamSettings(DEFAULT_EXAM_SETTINGS);
    setManualColoring(null);
    localStorage.removeItem('examslot_subjects');
    localStorage.removeItem('examslot_students');
    localStorage.removeItem('examslot_settings');
  };

  const handleManualMoveSubject = (subjectCode, targetSlot) => {
    setManualColoring((prev) => {
      const current = prev || { ...activeResult.coloring };
      return {
        ...current,
        [subjectCode]: targetSlot
      };
    });
  };

  const handleResetManualAdjustments = () => {
    setManualColoring(null);
  };

  // 4. Render Active View
  let activeViewComponent = null;

  switch (activeTab) {
    case 'dashboard':
      activeViewComponent = h(DashboardView, {
        graph: conflictGraph,
        students,
        subjects,
        activeAlgorithm,
        activeResult,
        allResults,
        metrics,
        timetable,
        onNavigateTab: setActiveTab,
        onSelectAlgorithm: setActiveAlgorithm
      });
      break;

    case 'live-form':
      activeViewComponent = h(LiveFormView, {
        subjects,
        students,
        onAddStudent: handleAddStudent,
        onResetStudents: handleRestoreDefaults,
        isSimulatingStream,
        onToggleSimulatingStream: setIsSimulatingStream,
        onSelectTab: setActiveTab
      });
      break;

    case 'students':
      activeViewComponent = h(StudentsView, {
        students,
        subjects,
        onAddStudent: handleAddStudent,
        onUpdateStudent: handleUpdateStudent,
        onDeleteStudent: handleDeleteStudent,
        onResetStudents: handleRestoreDefaults
      });
      break;

    case 'subjects':
      activeViewComponent = h(SubjectsView, {
        subjects,
        graph: conflictGraph,
        onAddSubject: handleAddSubject,
        onUpdateSubject: handleUpdateSubject,
        onDeleteSubject: handleDeleteSubject
      });
      break;

    case 'import':
      activeViewComponent = h(ImportView, {
        subjects,
        students,
        onCommitImport: handleCommitImport,
        onRestoreDefaults: handleRestoreDefaults,
        liveSheetUrl,
        onUpdateLiveSheetUrl: setLiveSheetUrl,
        isLiveSyncing,
        autoSyncEnabled,
        onToggleAutoSync: setAutoSyncEnabled,
        onTriggerLiveSync: handleSyncFromGoogleSheet,
        lastSyncTime
      });
      break;

    case 'conflicts':
      activeViewComponent = h(ConflictView, {
        graph: conflictGraph,
        onNavigateTab: setActiveTab
      });
      break;

    case 'graph':
      activeViewComponent = h(GraphView, {
        graph: conflictGraph,
        subjects,
        activeAlgorithm,
        activeResult,
        onSelectAlgorithm: setActiveAlgorithm,
        onNavigateTab: setActiveTab
      });
      break;

    case 'algorithms':
      activeViewComponent = h(AlgorithmsView, {
        graph: conflictGraph,
        subjects,
        allResults,
        activeAlgorithm,
        onSelectAlgorithm: (alg) => {
          setActiveAlgorithm(alg);
          setManualColoring(null);
        },
        onNavigateTab: setActiveTab
      });
      break;

    case 'timetable':
      activeViewComponent = h(TimetableView, {
        timetable,
        graph: conflictGraph,
        subjects,
        activeAlgorithm,
        examSettings,
        onUpdateExamSettings: setExamSettings,
        onManualMoveSubject: handleManualMoveSubject,
        onResetManualAdjustments: handleResetManualAdjustments
      });
      break;

    case 'analysis':
      activeViewComponent = h(AnalysisView, {
        graph: conflictGraph,
        subjects,
        allResults,
        metrics,
        timetable
      });
      break;

    case 'about':
      activeViewComponent = h(AboutView);
      break;

    default:
      activeViewComponent = h(DashboardView, {
        graph: conflictGraph,
        students,
        subjects,
        activeAlgorithm,
        activeResult,
        allResults,
        metrics,
        timetable,
        onNavigateTab: setActiveTab,
        onSelectAlgorithm: setActiveAlgorithm
      });
  }

  return h('div', { className: 'app-container' }, [
    // Sidebar Navigation
    h(Sidebar, {
      key: 'sidebar',
      activeTab,
      onSelectTab: setActiveTab,
      studentCount: students.length,
      subjectCount: subjects.length,
      conflictCount: conflictGraph.totalEdges,
      slotCount: timetable.slotCount
    }),

    // Main Content
    h('main', { key: 'main', className: 'main-content' }, [
      h(Navbar, {
        key: 'navbar',
        activeTab,
        activeAlgorithm,
        totalSlots: timetable.slotCount,
        isConflictFree: timetable.isConflictFree,
        onResetData: handleRestoreDefaults,
        onPrintTimetable: () => exportTimetableToPDF(timetable, conflictGraph),
        liveSheetUrl,
        isLiveSyncing,
        onTriggerLiveSync: () => handleSyncFromGoogleSheet(liveSheetUrl)
      }),
      h('div', { key: 'body', className: 'content-body' }, activeViewComponent),

      // Live Toast Notification for real-time registrations
      liveToast && h('div', {
        key: 'live-toast',
        className: 'fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-emerald-500/50 flex items-center gap-3 animate-bounce transition-all'
      }, [
        h('span', { className: 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping' }),
        h('span', { className: 'text-xs font-semibold' }, liveToast),
        h('button', {
          className: 'text-slate-400 hover:text-white text-xs ml-2 font-bold',
          onClick: () => setLiveToast(null)
        }, '✕')
      ])
    ])
  ]);
}

