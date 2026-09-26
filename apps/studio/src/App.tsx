import { useCallback, useEffect, useState } from "react";
import { emptyLifeMap, type AgentDefinition, type ConsentGrant, type LifeMap } from "@brad/domain";
import { api, ApiError } from "./api";
import { useI18n, type Lang } from "./i18n";
import { Agents } from "./steps/Agents";
import { Audit } from "./steps/Audit";
import { Diagnostic } from "./steps/Diagnostic";
import { LifeMapEditor } from "./steps/LifeMapEditor";
import { Simulation } from "./steps/Simulation";

const STEPS = ["diagnostic", "lifeMap", "agents", "simulation", "audit"] as const;
export type Step = (typeof STEPS)[number];

export function App() {
  const { t, lang, setLang } = useI18n();
  const [step, setStep] = useState<Step>("diagnostic");
  const [lifeMap, setLifeMap] = useState<LifeMap>(emptyLifeMap);
  const [dirty, setDirty] = useState(false);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [grants, setGrants] = useState<ConsentGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped whenever stored data changes wholesale, so step views drop stale results.
  const [epoch, setEpoch] = useState(0);

  const report = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) setError([e.message, ...(e.details ?? [])].join(" · "));
      else setError(t("app.apiDown"));
    },
    [t],
  );

  useEffect(() => {
    Promise.all([api.getLifeMap(), api.getAgents()])
      .then(([map, list]) => {
        if (map.lifeMap) setLifeMap(map.lifeMap);
        setAgents(list.agents);
        setGrants(list.grants);
      })
      .catch(report);
    // Load once on start; `report` only formats errors.
  }, []);

  const edit = (next: LifeMap) => {
    setLifeMap(next);
    setDirty(true);
  };

  const save = async (then?: Step) => {
    try {
      const res = await api.saveLifeMap(lifeMap);
      setLifeMap(res.lifeMap);
      setDirty(false);
      setError(null);
      if (then) setStep(then);
    } catch (e) {
      report(e);
    }
  };

  const refreshAgents = useCallback(async () => {
    try {
      const list = await api.getAgents();
      setAgents(list.agents);
      setGrants(list.grants);
    } catch (e) {
      report(e);
    }
  }, [report]);

  const exportData = async () => {
    try {
      const data = await api.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `brad-export-${data.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      report(e);
    }
  };

  const importData = async (file: File | undefined) => {
    if (!file || !window.confirm(t("app.importConfirm"))) return;
    try {
      const res = await api.importData(JSON.parse(await file.text()));
      setLifeMap(res.lifeMap);
      setAgents(res.agents);
      setGrants(res.grants);
      setDirty(false);
      setError(null);
      setEpoch((n) => n + 1);
    } catch (e) {
      report(e instanceof SyntaxError ? new ApiError(t("app.importInvalid")) : e);
    }
  };

  const loadDemo = async () => {
    try {
      const res = await api.loadDemo();
      setLifeMap(res.lifeMap);
      setAgents(res.agents);
      await refreshAgents();
      setDirty(false);
      setError(null);
      setEpoch((n) => n + 1);
    } catch (e) {
      report(e);
    }
  };

  const reset = async () => {
    if (!window.confirm(t("app.resetConfirm"))) return;
    try {
      await api.reset();
      setLifeMap(emptyLifeMap());
      setAgents([]);
      setGrants([]);
      setDirty(false);
      setError(null);
      setEpoch((n) => n + 1);
      setStep("diagnostic");
    } catch (e) {
      report(e);
    }
  };

  const generate = async () => {
    try {
      if (dirty) await save();
      const res = await api.generateAgents();
      setAgents(res.agents);
      setGrants(res.grants);
      setError(null);
    } catch (e) {
      report(e);
    }
  };

  return (
    <div className="shell">
      <header className="top">
        <div>
          <h1>{t("app.title")}</h1>
          <p className="tagline">{t("app.tagline")}</p>
          <p className="muted small">{t("app.localOnly")}</p>
        </div>
        <div className="top-actions">
          <div className="lang" role="group" aria-label={t("app.language")}>
            {(["en", "pt"] as Lang[]).map((l) => (
              <button key={l} className={lang === l ? "on" : ""} onClick={() => setLang(l)} data-testid={`lang-${l}`}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="primary" onClick={loadDemo} data-testid="load-demo">
            {t("app.loadDemo")}
          </button>
          <button className="ghost" onClick={exportData} data-testid="export">
            {t("app.export")}
          </button>
          <label className="button ghost">
            {t("app.import")}
            <input
              type="file"
              accept="application/json,.json"
              hidden
              data-testid="import"
              onChange={(e) => {
                void importData(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button className="ghost" onClick={reset}>
            {t("app.reset")}
          </button>
        </div>
      </header>

      <nav className="steps">
        {STEPS.map((s) => (
          <button key={s} className={step === s ? "on" : ""} onClick={() => setStep(s)} data-testid={`step-${s}`}>
            {t(`step.${s}`)}
          </button>
        ))}
        <span className={`save-state ${dirty ? "dirty" : ""}`}>{dirty ? t("common.unsaved") : t("common.saved")}</span>
      </nav>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <main>
        {step === "diagnostic" && <Diagnostic lifeMap={lifeMap} onChange={edit} onNext={() => save("lifeMap")} />}
        {step === "lifeMap" && <LifeMapEditor lifeMap={lifeMap} onChange={edit} onNext={() => save("agents")} />}
        {step === "agents" && (
          <Agents
            agents={agents}
            grants={grants}
            onGenerate={generate}
            onChanged={refreshAgents}
            onNext={() => setStep("simulation")}
          />
        )}
        {step === "simulation" && <Simulation key={epoch} lifeMap={lifeMap} agents={agents.filter((a) => a.state !== "archived")} onError={report} />}
        {step === "audit" && <Audit key={epoch} onError={report} />}
      </main>
    </div>
  );
}
