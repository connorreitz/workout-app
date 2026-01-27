import React, { useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { PlusCircle, Play, BarChart2, Settings as SettingsIcon, Save, Trash2, XCircle } from 'lucide-react';
import { db } from './db'; // Make sure db.js is in the same directory

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export default function WorkoutApp() {
  const [activeTab, setActiveTab] = useState('plan');
  const [fileHandle, setFileHandle] = useState(null); // Persist file handle for auto-overwrite
  const [logs, setLogs] = useState([]); // All historical workout logs
  const [plans, setPlans] = useState([]); // All workout plans
  const [activePlan, setActivePlan] = useState(null); // The plan currently being executed

  // Load all logs and plans on app start or tab change
  useEffect(() => {
    const refreshData = async () => {
      // Grab everything from Dexie
      const allLogs = await db.logs.toArray();
      const allPlans = await db.plans.toArray();
      
      // Update the state so ActiveSession can see them
      setLogs(allLogs);
      setPlans(allPlans);
      
      //console.log("Database Sync: Found", allLogs.length, "logs.");
    };

    refreshData();
  }, [activeTab]);

  // --- Backup Logic (Overwrites local file) ---
  const saveToBackupFile = async () => {
    const allData = {
      logs: await db.logs.toArray(),
      plans: await db.plans.toArray(),
      exercises: await db.exercises.toArray()
    };
    const dataStr = JSON.stringify(allData, null, 2);
  
    // 1. Check if the "Modern" Overwrite API exists (Android/Chrome/Desktop)
    if ('showSaveFilePicker' in window) {
      try {
        let handle = fileHandle;
        if (!handle) {
          handle = await window.showSaveFilePicker({
            suggestedName: 'my_workout_backup.json',
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          });
          setFileHandle(handle);
        }
        const writable = await handle.createWritable();
        await writable.write(dataStr);
        await writable.close();
        return; // Exit successfully
      } catch (err) {
        console.warn("Modern backup failed or was cancelled, falling back to download.");
      }
    }
  
    // 2. iOS Fallback (Standard Download)
    // This will save to the "Downloads" folder or "Files" app on iPhone
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `workout_backup.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  // --- Session Completion Handler ---
  const handleFinishSession = async (planTitle, sessionResults) => {
    const newLog = {
      planTitle: planTitle,
      date: new Date().toISOString(),
      exercises: sessionResults
    };

    // 1. Save to local IndexedDB
    await db.logs.add(newLog);

    // 2. Refresh local state for graphs
    setLogs(await db.logs.toArray());

    // 3. Silently overwrite the backup JSON file on the device
    await saveToBackupFile(); 
    
    setActivePlan(null); // Reset active plan
    setActiveTab('insights'); // Go to insights
    alert("Workout complete! Data saved and backup file updated.");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-20">
      <main className="max-w-md mx-auto p-4">
        {activeTab === 'plan' && <PlanCreator plans={plans} setPlans={setPlans} />}
        {activeTab === 'active' && (
          activePlan ? (
            <ActiveSession plan={activePlan} logs={logs} onCancel={() => setActivePlan(null)} onFinish={handleFinishSession} />
          ) : (
            <PlanSelector plans={plans} onSelectPlan={setActivePlan} />
          )
        )}
        {activeTab === 'insights' && <InsightsView logs={logs} />}
        {activeTab === 'settings' && <SettingsView onBackup={saveToBackupFile} fileHandle={fileHandle} setFileHandle={setFileHandle} setLogs={setLogs} setPlans={setPlans} />}
      </main>

      {/* 4. Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex justify-around p-4 z-50">
        <button onClick={() => setActiveTab('plan')} className="flex flex-col items-center text-xs">
          <PlusCircle color={activeTab === 'plan' ? '#3b82f6' : '#94a3b8'} size={24} />
          <span className={activeTab === 'plan' ? 'text-blue-500' : 'text-slate-400'}>Plan</span>
        </button>
        <button onClick={() => setActiveTab('active')} className="flex flex-col items-center text-xs">
          <Play color={activeTab === 'active' ? '#3b82f6' : '#94a3b8'} size={24} />
          <span className={activeTab === 'active' ? 'text-blue-500' : 'text-slate-400'}>Workout</span>
        </button>
        <button onClick={() => setActiveTab('insights')} className="flex flex-col items-center text-xs">
          <BarChart2 color={activeTab === 'insights' ? '#3b82f6' : '#94a3b8'} size={24} />
          <span className={activeTab === 'insights' ? 'text-blue-500' : 'text-slate-400'}>Insights</span>
        </button>
        <button onClick={() => setActiveTab('settings')} className="flex flex-col items-center text-xs">
          <SettingsIcon color={activeTab === 'settings' ? '#3b82f6' : '#94a3b8'} size={24} />
          <span className={activeTab === 'settings' ? 'text-blue-500' : 'text-slate-400'}>Settings</span>
        </button>
      </nav>
    </div>
  );
}

// --- SUB-COMPONENTS ---

// PlanCreator allows creating/editing workout plans and their exercises
function PlanCreator({ plans, setPlans }) {
  const [planTitle, setPlanTitle] = useState('');
  const [currentPlanExercises, setCurrentPlanExercises] = useState([]); // Exercises being added to the current plan
  const [addingCustomExercise, setAddingCustomExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [availableExercises, setAvailableExercises] = useState([]); // All unique workout names ever entered
  const [recentWorkouts, setRecentWorkouts] = useState([]); // Last 3 completed workout plan titles

  useEffect(() => {
    // Load all unique exercises ever logged/planned
    const fetchExercises = async () => {
      const allLogs = await db.logs.toArray();
      const allPlans = await db.plans.toArray();

      const uniqueNames = new Set();
      allLogs.forEach(log => log.exercises.forEach(ex => uniqueNames.add(ex.name)));
      allPlans.forEach(plan => plan.exercises.forEach(ex => uniqueNames.add(ex.name)));

      setAvailableExercises(Array.from(uniqueNames).sort());

      // Get last 3 completed workout plan titles
      const sortedLogs = [...allLogs].sort((a, b) => new Date(b.date) - new Date(a.date));
      const recentTitles = sortedLogs.slice(0, 3).map(log => log.planTitle);
      setRecentWorkouts(recentTitles);
    };
    fetchExercises();
  }, [plans]); // Re-fetch if plans change (new plan might add new exercises)

  const addExerciseToPlan = (exerciseName) => {
    setCurrentPlanExercises([...currentPlanExercises, { name: exerciseName, goalSets: 3, goalReps: "8-12" }]);
    setNewExerciseName('');
    setAddingCustomExercise(false);
  };

  const updatePlanExercise = (index, field, value) => {
    const updated = [...currentPlanExercises];
    updated[index][field] = value;
    setCurrentPlanExercises(updated);
  };

  const removeExerciseFromPlan = (index) => {
    setCurrentPlanExercises(currentPlanExercises.filter((_, i) => i !== index));
  };

  const savePlan = async () => {
    if (!planTitle.trim()) {
      alert("Plan title cannot be empty.");
      return;
    }
    await db.plans.add({ title: planTitle, exercises: currentPlanExercises });
    setPlanTitle('');
    setCurrentPlanExercises([]);
    setPlans(await db.plans.toArray()); // Refresh plans list
    alert("Plan saved successfully!");
  };

  const deletePlan = async (id) => {
    if (window.confirm("Are you sure you want to delete this plan?")) {
      await db.plans.delete(id);
      setPlans(await db.plans.toArray());
      alert("Plan deleted.");
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold mb-4">Create/Manage Plans</h1>

      {/* Recent Workouts Section */}
      {recentWorkouts.length > 0 && (
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
          <h2 className="text-sm font-semibold text-slate-400 mb-2">Recent Workouts</h2>
          <div className="flex flex-wrap gap-2">
            {recentWorkouts.map((title, i) => (
              <span key={i} className="bg-slate-800 text-slate-300 text-sm px-3 py-1 rounded-full border border-slate-700">
                {title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Create New Plan Section */}
      <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-4">
        <h2 className="text-xl font-semibold text-blue-400">New Plan</h2>
        <input 
          className="w-full bg-slate-800 p-3 rounded-lg text-lg border border-slate-700 focus:ring focus:ring-blue-500"
          placeholder="Plan Title (e.g., Push Day, Full Body A)"
          value={planTitle}
          onChange={(e) => setPlanTitle(e.target.value)}
        />
        
        {/* Exercises in current new plan */}
        {currentPlanExercises.map((ex, i) => (
          <div key={i} className="bg-slate-800 p-3 rounded-lg flex flex-col md:flex-row gap-2 items-center border border-blue-600">
            <span className="font-semibold text-md w-full md:w-1/3">{ex.name}</span>
            <div className="flex gap-2 w-full md:w-2/3">
              <input type="number" placeholder="Sets" value={ex.goalSets}
                     onChange={(e) => updatePlanExercise(i, 'goalSets', e.target.value)}
                     className="bg-slate-700 p-2 rounded w-1/2 text-center" />
              <input type="text" placeholder="Reps (e.g., 8-12)" value={ex.goalReps}
                     onChange={(e) => updatePlanExercise(i, 'goalReps', e.target.value)}
                     className="bg-slate-700 p-2 rounded w-1/2 text-center" />
            </div>
            <button onClick={() => removeExerciseFromPlan(i)} className="text-red-400 p-1"><XCircle size={20}/></button>
          </div>
        ))}

        {/* Add Exercise to Plan Controls */}
        <button 
          onClick={() => setAddingCustomExercise(!addingCustomExercise)}
          className="w-full border-2 border-dashed border-slate-700 p-3 rounded-xl text-slate-400 hover:border-blue-500 transition-colors"
        >
          {addingCustomExercise ? '- Cancel Adding Exercise' : '+ Add Exercise to Plan'}
        </button>

        {addingCustomExercise && (
          <div className="bg-slate-800 p-3 rounded-lg space-y-3">
            <input 
              className="w-full bg-slate-700 p-2 rounded-lg"
              placeholder="Type new or select existing workout..."
              value={newExerciseName}
              onChange={(e) => setNewExerciseName(e.target.value)}
            />
            <button 
              onClick={() => { if (newExerciseName.trim()) addExerciseToPlan(newExerciseName.trim()); }}
              className="w-full bg-blue-600 p-2 rounded-lg font-medium"
            >
              Add Custom Workout "{newExerciseName || '...'}"
            </button>
            
            {/* Suggestions from available exercises */}
            <div className="max-h-40 overflow-y-auto bg-slate-700 p-2 rounded-lg mt-2">
              <p className="text-slate-400 text-sm mb-1">Existing Workouts:</p>
              {availableExercises
                .filter(ex => ex.toLowerCase().includes(newExerciseName.toLowerCase()) && !currentPlanExercises.some(pEx => pEx.name === ex))
                .map(ex => (
                  <button key={ex} onClick={() => addExerciseToPlan(ex)} className="block w-full text-left p-1 text-blue-300 hover:bg-slate-600 rounded">
                    {ex}
                  </button>
                ))}
            </div>
          </div>
        )}

        <button onClick={savePlan} className="w-full bg-blue-600 p-4 rounded-xl font-bold mt-4">Create New Plan</button>
      </div>

      {/* Existing Plans List */}
      <h2 className="text-xl font-bold mt-8 mb-4">Your Saved Plans</h2>
      {plans.length === 0 ? (
        <p className="text-slate-500 text-center">No plans created yet. Use the section above!</p>
      ) : (
        <div className="space-y-3">
          {plans.map(plan => (
            <div key={plan.id} className="bg-slate-900 p-4 rounded-xl border border-slate-800 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg">{plan.title}</h3>
                <p className="text-slate-400 text-sm">{plan.exercises.length} exercises</p>
              </div>
              <button onClick={() => deletePlan(plan.id)} className="text-red-400 p-2"><Trash2 size={20}/></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// PlanSelector: When "Active" tab is chosen, user picks a plan to start
function PlanSelector({ plans, onSelectPlan }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-center mb-6">Select Today's Plan</h1>
      {plans.length === 0 ? (
        <p className="text-slate-500 text-center mt-10">No workout plans found. Go to 'Plan' tab to create one.</p>
      ) : (
        <div className="space-y-4">
          {plans.map(plan => (
            <button 
              key={plan.id}
              onClick={() => onSelectPlan(plan)}
              className="w-full bg-slate-800 p-6 rounded-2xl border border-slate-700 text-left hover:border-blue-500 transition-colors"
            >
              <h2 className="text-xl font-bold">{plan.title}</h2>
              <p className="text-slate-400 text-sm">{plan.exercises.length} Exercises</p>
              {plan.exercises.map((ex, i) => (
                <span key={i} className="bg-slate-700 text-slate-300 text-xs px-2 py-1 rounded-full mr-1 mt-1 inline-block">
                  {ex.name}
                </span>
              ))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ActiveSession: User fills in actual weight/reps for a selected plan
function ActiveSession({ plan, logs, onFinish, onCancel }) {
  // 1. Internal Helper (Prevents "Not Defined" errors)
  const findPrevious = (workoutName) => {
    if (!logs || logs.length === 0) return null;
    const relevant = [...logs]
      .filter(l => l.exercises.some(e => e.name.toLowerCase() === workoutName.toLowerCase()))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (relevant.length === 0) return null;
    return relevant[0].exercises.find(e => e.name.toLowerCase() === workoutName.toLowerCase()).sets;
  };

  const [results, setResults] = useState(plan.exercises.map(ex => ({
    name: ex.name,
    sets: Array.from({ length: ex.goalSets || 3 }, () => ({ weight: '', reps: '' }))
  })));

  const updateResult = (exIdx, setIdx, field, val) => {
    const newResults = [...results];
    newResults[exIdx].sets[setIdx][field] = val;
    setResults(newResults);
  };

  return (
    <div className="space-y-8 pb-32">
      <div className="flex justify-between items-center px-2">
        <h1 className="text-2xl font-bold text-blue-500 italic">{plan.title}</h1>
        <button onClick={onCancel} className="text-slate-500"><XCircle size={24} /></button>
      </div>

      {results.map((ex, exIdx) => {
        // Look up data using the internal helper
        const prevPerformance = findPrevious(ex.name);

        // Find the original plan data to get the goalReps
  const planExercise = plan.exercises.find(pe => pe.name === ex.name);

        return (
          <div key={exIdx} className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-4 shadow-md">
      {/* Updated Header with Workout Name and Target Reps */}
      <div className="flex justify-between items-end border-l-4 border-blue-600 pl-3">
        <h2 className="text-lg font-bold uppercase tracking-tight text-white">
          {ex.name}
        </h2>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest pb-1">
          Target: {planExercise?.goalReps || '8-12'}
        </span>
      </div>

      {/* NEW: Input Box Labels */}
      <div className="flex gap-3 px-2 mb-[-8px]">
        <div className="w-8"></div> {/* Spacer for the "S1" label */}
        <span className="flex-1 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest">Weight</span>
        <span className="flex-1 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest">Reps</span>
      </div>
            
            {ex.sets.map((set, setIdx) => {
              const prevSet = prevPerformance?.[setIdx];

              return (
                <div key={setIdx} className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-600 w-8">S{setIdx + 1}</span>
                  
                  <input 
                    type="number" 
                    className="bg-slate-800 text-slate-100 p-3 rounded-lg w-full text-center border border-slate-700 outline-none focus:border-blue-500"
                    placeholder={prevSet ? `Last: ${prevSet.weight}` : "Weight"}
                    value={set.weight}
                    onChange={(e) => updateResult(exIdx, setIdx, 'weight', e.target.value)}
                  />
                  
                  <input 
                    type="number" 
                    className="bg-slate-800 text-slate-100 p-3 rounded-lg w-full text-center border border-slate-700 outline-none focus:border-blue-500"
                    placeholder={prevSet ? `Last: ${prevSet.reps}` : "Reps"}
                    value={set.reps}
                    onChange={(e) => updateResult(exIdx, setIdx, 'reps', e.target.value)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

      <button 
        onClick={() => onFinish(plan.title, results)} 
        className="w-full bg-blue-600 p-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 shadow-xl"
      >
        <Save size={24} /> FINISH WORKOUT
      </button>
    </div>
  );
}

// InsightsView: Displays graphs for individual workouts
function InsightsView({ logs }) {
  // Helper to get the best set (max weight) for a given workout from a session
  const getBestSetForWorkout = (logEntry, workoutName) => {
    const workoutEntry = logEntry.exercises.find(ex => ex.name === workoutName);
    if (!workoutEntry || !workoutEntry.sets.length) return { weight: 0, reps: 0, oneRM: 0 };

    // Find the set with the maximum weight for this specific workout within this log entry
    const bestSet = workoutEntry.sets.reduce((prev, current) => {
      return (parseFloat(current.weight) > parseFloat(prev.weight)) ? current : prev;
    }, { weight: 0, reps: 0 });

    const calculated1RM = bestSet.weight && bestSet.reps ? Math.round(parseFloat(bestSet.weight) / (1.0278 - (0.0278 * parseFloat(bestSet.reps)))) : 0;

    return {
      weight: parseFloat(bestSet.weight),
      reps: parseInt(bestSet.reps),
      oneRM: calculated1RM
    };
  };

  // Get all unique exercise names ever logged
  const uniqueExercises = [...new Set(logs.flatMap(l => l.exercises.map(ex => ex.name)))].filter(Boolean).sort();
  const [selectedExercise, setSelectedExercise] = useState(null); // Which graph is currently open
  const [metricType, setMetricType] = useState('weight'); // 'weight' or '1rm'

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-center mb-6">Your Progress Insights</h1>
      
      {uniqueExercises.length === 0 ? (
        <p className="text-slate-500 text-center mt-10">No workout data found yet. Complete a session to see progress!</p>
      ) : (
        <div className="space-y-3">
          {uniqueExercises.map((exName) => (
            <div key={exName} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800 shadow-md">
              <button 
                onClick={() => setSelectedExercise(selectedExercise === exName ? null : exName)}
                className="w-full flex justify-between items-center p-4 hover:bg-slate-800 transition-colors"
              >
                <span className="font-semibold text-lg">{exName}</span>
                <span className="text-blue-500">{selectedExercise === exName ? 'Close Graph ▲' : 'View Graph ▼'}</span>
              </button>
              
              {selectedExercise === exName && (
                <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-4">
                  <div className="flex justify-center gap-4">
                    <button 
                      onClick={() => setMetricType('weight')} 
                      className={`px-4 py-2 rounded-lg text-sm font-medium ${metricType === 'weight' ? 'bg-blue-600' : 'bg-slate-700 text-slate-300'}`}
                    >
                      Weight Attempted
                    </button>
                    <button 
                      onClick={() => setMetricType('1rm')} 
                      className={`px-4 py-2 rounded-lg text-sm font-medium ${metricType === '1rm' ? 'bg-blue-600' : 'bg-slate-700 text-slate-300'}`}
                    >
                      Estimated 1RM
                    </button>
                  </div>

                  <div className="h-60 w-full"> {/* Responsive container for chart */}
                    <Line data={{
                      labels: logs
                        .filter(log => log.exercises.some(e => e.name === exName))
                        .map(log => new Date(log.date).toLocaleDateString()),
                      datasets: [{
                        label: `${exName} - ${metricType === 'weight' ? 'Weight (lbs/kg)' : 'Estimated 1RM (lbs/kg)'}`,
                        data: logs
                          .filter(log => log.exercises.some(e => e.name === exName))
                          .map(log => {
                            const bestSetData = getBestSetForWorkout(log, exName);
                            return metricType === 'weight' ? bestSetData.weight : bestSetData.oneRM;
                          }),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.2)', // Light fill for the graph
                        tension: 0.3,
                        pointBackgroundColor: '#3b82f6',
                        pointBorderColor: '#fff',
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: '#3b82f6',
                        fill: true // Fill area under the line
                      }]
                    }} options={{ 
                          responsive: true, 
                          maintainAspectRatio: false,
                          scales: {
                            y: {
                              beginAtZero: false,
                              title: {
                                display: true,
                                text: metricType === 'weight' ? 'Weight (lbs/kg)' : 'Estimated 1RM (lbs/kg)',
                                color: '#94a3b8'
                              },
                              grid: { color: 'rgba(255,255,255,0.1)' }
                            },
                            x: {
                              title: {
                                display: true,
                                text: 'Date',
                                color: '#94a3b8'
                              },
                              grid: { color: 'rgba(255,255,255,0.1)' }
                            }
                          },
                          plugins: {
                            legend: { display: false }, // Only one dataset, no need for legend
                            tooltip: {
                              callbacks: {
                                label: function(context) {
                                  let label = context.dataset.label || '';
                                  if (label) {
                                      label += ': ';
                                  }
                                  if (context.parsed.y !== null) {
                                      label += new Intl.NumberFormat('en-US', { style: 'decimal' }).format(context.parsed.y);
                                  }
                                  return label;
                                }
                              }
                            }
                          }
                        }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// SettingsView: For backup/restore and app management
function SettingsView({ onBackup, fileHandle, setFileHandle, setLogs, setPlans }) {
  const importData = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      alert("No file selected.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const { logs: importedLogs, plans: importedPlans, exercises: importedExercises } = JSON.parse(e.target.result);
        
        // Clear existing data (optional, but good for a clean import)
        await db.logs.clear();
        await db.plans.clear();
        await db.exercises.clear();

        // Add imported data
        if (importedLogs) await db.logs.bulkAdd(importedLogs);
        if (importedPlans) await db.plans.bulkAdd(importedPlans);
        if (importedExercises) await db.exercises.bulkAdd(importedExercises);
        
        // Refresh app state
        setLogs(await db.logs.toArray());
        setPlans(await db.plans.toArray());
        setFileHandle(null); // Reset file handle as the old one might not be valid after import
        alert("Data imported successfully! App state refreshed.");
      } catch (error) {
        console.error("Error importing data:", error);
        alert("Failed to import data. Ensure it's a valid JSON backup file.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-center mb-6">App Settings</h1>
      
      <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-4 shadow-lg">
        <h2 className="font-semibold text-lg text-blue-400">Data Management</h2>
        <p className="text-sm text-slate-400">
          All your workout data is stored locally on this device.
        </p>
        <p className="text-sm text-slate-400 flex items-center gap-2">
          Backup Status: 
          {fileHandle ? <span className="text-green-500 font-medium">Connected to file</span> : <span className="text-yellow-500 font-medium">Not yet connected</span>}
        </p>
        <button 
          onClick={onBackup} 
          className="w-full bg-blue-600 hover:bg-blue-700 transition-colors p-3 rounded-lg font-bold flex items-center justify-center gap-2"
        >
          <Save size={18} /> {fileHandle ? 'Update Connected Backup File' : 'Create/Select Backup File'}
        </button>
        
        <label className="block w-full bg-slate-800 hover:bg-slate-700 transition-colors p-3 rounded-lg text-center cursor-pointer font-bold border border-slate-700">
          Import Data From File
          <input type="file" className="hidden" onChange={importData} accept=".json" />
        </label>
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-4 shadow-lg">
        <h2 className="font-semibold text-lg text-red-400">Danger Zone</h2>
        <p className="text-sm text-slate-400">
          This will permanently delete all workout logs and plans from this device.
        </p>
        <button 
          onClick={async () => {
            if (window.confirm("Are you ABSOLUTELY sure you want to delete ALL data? This cannot be undone.")) {
              await db.logs.clear();
              await db.plans.clear();
              await db.exercises.clear();
              setLogs([]);
              setPlans([]);
              alert("All local data deleted.");
            }
          }} 
          className="w-full bg-red-600 hover:bg-red-700 transition-colors p-3 rounded-lg font-bold"
        >
          Delete All Local Data
        </button>
      </div>
    </div>
  );
}