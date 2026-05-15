// Response shape of GET /api/anomaly-analysis (post-simplification).
// All intelligence comes from fraud_detection_model.pkl via FastAPI — no
// rule-based deviation logic survives in this flow.

export type Severity = 'critical' | 'medium' | 'low' | 'normal'

export interface AnomalySignal {
  name: string
  severity: Severity | string
}

export interface AnomalyMonthlyRecord {
  periode: string   // "Mei 2026"
  actual: number    // kWh from consumption_data
}

export interface AnomalyAnalysis {
  idpel: string
  unitup: string
  tarif: string
  daya: number
  is_anomaly: boolean    // from RandomForest fraud model
  confidence: number     // 0..1 from RF
  risk_score: number     // confidence × 100, integer
  model_used?: string    // "RandomForest (fraud_detection_model.pkl)"
  signals: AnomalySignal[]
  monthly: AnomalyMonthlyRecord[]
  summary: {
    total_months: number
    is_anomaly: boolean
    confidence_pct: number   // 0..100, integer
  }
}

export interface IDPELItem {
  idpel: string
  unitup: string
}
