
import { useState } from 'react'
import axios from 'axios'
import Plot from 'react-plotly.js'
import sampleFileUrl from '../sample/samplefile.csv?url'
import './App.css'

function App() {
  const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '')
  const previewPageSize = 10
  const resultsPageSize = 10
  const rollingWindowSize = 5
  const modifiedZScoreThreshold = 3.5
  const dayOverDayChangeThreshold = 0.05
  const [file, setFile] = useState(null)
  const [data, setData] = useState([])
  const [previewHeaders, setPreviewHeaders] = useState([])
  const [previewRows, setPreviewRows] = useState([])
  const [isUploading, setIsUploading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const parseCsvLine = (line) => line.split(',').map((value) => value.trim())

  const buildFallbackExplanation = ({
    rollingAnomaly,
    dayChangeAnomaly,
  }) => {
    const reasonParts = []

    if (rollingAnomaly) {
      reasonParts.push(
        'NAV is materially out of line with the recent valuation pattern and may reflect a pricing break, missing trade, stale position, or corporate action not captured correctly'
      )
    }

    if (dayChangeAnomaly) {
      reasonParts.push(
        'NAV moved sharply versus the prior day and should be reviewed for late postings, cash movement, FX impact, security revaluation, or booking issues'
      )
    }

    if (!reasonParts.length) {
      return 'Normal: NAV is broadly consistent with recent activity and does not show an unusual day-over-day movement.'
    }

    return `Anomaly: ${reasonParts.join('. ')}.`
  }

  const enrichResultsWithStats = (rows) => {
    if (!rows.length) {
      return rows
    }

    const getMedian = (values) => {
      const middle = Math.floor(values.length / 2)

      if (values.length % 2 === 0) {
        return (values[middle - 1] + values[middle]) / 2
      }

      return values[middle]
    }

    return rows.map((row, index) => {
      const nav = Number(row.NAV)
      const rollingWindow = rows
        .slice(Math.max(0, index - rollingWindowSize), index)
        .map((item) => Number(item.NAV))
      const rollingMedian =
        rollingWindow.length > 0 ? getMedian([...rollingWindow].sort((a, b) => a - b)) : nav
      const absoluteDeviations = rollingWindow
        .map((windowNav) => Math.abs(windowNav - rollingMedian))
        .sort((first, second) => first - second)
      const mad = absoluteDeviations.length > 0 ? getMedian(absoluteDeviations) : 0
      const modifiedZScore = mad === 0 ? 0 : 0.6745 * (nav - rollingMedian) / mad
      const previousNav = index > 0 ? Number(rows[index - 1].NAV) : null
      const dayOverDayChange = previousNav && previousNav !== 0 ? (nav - previousNav) / previousNav : 0
      const rollingAnomaly =
        rollingWindow.length >= 3 && Math.abs(modifiedZScore) > modifiedZScoreThreshold
      const dayChangeAnomaly =
        index > 0 && Math.abs(dayOverDayChange) > dayOverDayChangeThreshold
      const anomalyFlag =
        row.anomaly_flag ?? (rollingAnomaly || dayChangeAnomaly)

      return {
        ...row,
        rolling_median_nav: row.rolling_median_nav ?? Number(rollingMedian.toFixed(2)),
        mad: row.mad ?? Number(mad.toFixed(2)),
        modified_z_score: row.modified_z_score ?? Number(modifiedZScore.toFixed(2)),
        day_over_day_change_pct:
          row.day_over_day_change_pct ?? Number((dayOverDayChange * 100).toFixed(2)),
        detection_reason:
          row.detection_reason ??
          (anomalyFlag
            ? [
                rollingAnomaly ? 'Rolling median/MAD' : null,
                dayChangeAnomaly ? 'Day-over-day change > 5%' : null,
              ]
                .filter(Boolean)
                .join(' + ')
            : 'Within rolling range'),
        anomaly_flag: anomalyFlag,
        explanation:
          row.explanation?.trim() ||
          buildFallbackExplanation({
            rollingAnomaly,
            dayChangeAnomaly,
          }),
      }
    })
  }

  const updatePreviewFromFile = async (selectedFile) => {
    if (!selectedFile) {
      setPreviewHeaders([])
      setPreviewRows([])
      return
    }

    const text = await selectedFile.text()
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length === 0) {
      setPreviewHeaders([])
      setPreviewRows([])
      return
    }

    const headers = parseCsvLine(lines[0])
    const rows = lines.slice(1, previewPageSize + 1).map((line) => parseCsvLine(line))

    setPreviewHeaders(headers)
    setPreviewRows(rows)
  }

  const handleFileChange = async (event) => {
    const selectedFile = event.target.files[0]
    setFile(selectedFile)
    setData([])
    setCurrentPage(1)
    await updatePreviewFromFile(selectedFile)
  }

  const useSampleFile = async () => {
    const response = await fetch(sampleFileUrl)
    const blob = await response.blob()
    const sampleFile = new File([blob], 'samplefile.csv', {
      type: blob.type || 'text/csv',
    })

    setFile(sampleFile)
    setData([])
    setCurrentPage(1)
    await updatePreviewFromFile(sampleFile)
  }

  const uploadFile = async () => {
    if (!file || !apiUrl) return

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await axios.post(`${apiUrl}/upload`, formData)
      setData(enrichResultsWithStats(res.data))
      setCurrentPage(1)
      setPreviewHeaders([])
      setPreviewRows([])
    } finally {
      setIsUploading(false)
    }
  }

  const sortedResults = [...data].sort((firstRow, secondRow) => {
    if (firstRow.anomaly_flag === secondRow.anomaly_flag) {
      return 0
    }

    return firstRow.anomaly_flag ? -1 : 1
  })

  const totalPages = Math.ceil(sortedResults.length / resultsPageSize)
  const paginatedResults = sortedResults.slice(
    (currentPage - 1) * resultsPageSize,
    currentPage * resultsPageSize
  )

  return (
    <div className="app-shell">
      <div className="app-backdrop app-backdrop-one" />
      <div className="app-backdrop app-backdrop-two" />

      <div className="dashboard-card">
        <header className="hero-section">
          <div>
            <p className="eyebrow">Fund Accounting Control Center</p>
            <h1>AI Anomaly Detection Dashboard</h1>
            <p className="hero-copy">
              Upload NAV records, preview the source file, and review anomalies with business-ready explanations.
            </p>
          </div>
          <div className="hero-badge">
            <span className="hero-badge-label">Detection</span>
            <strong>Rolling Pattern + Day Change</strong>
          </div>
        </header>

        <section className="controls-panel">
          <div className="control-group">
            <label className="field-label" htmlFor="csvUpload">Select NAV File</label>
            <input id="csvUpload" className="file-input" type="file" onChange={handleFileChange}/>
          </div>
          <div className="button-row">
            <button className="secondary-button" onClick={useSampleFile}>Use Sample File</button>
            <button className="primary-button" onClick={uploadFile} disabled={!file || !apiUrl}>Upload</button>
          </div>
        </section>

        {!apiUrl && (
          <div className="env-warning">
            <span className="chip-label">Configuration Needed</span>
            <p>
              Set <strong>VITE_API_URL</strong> in your frontend environment so the deployed app can reach the backend.
            </p>
          </div>
        )}

        {file && (
          <div className="selected-file-chip">
            <span className="chip-label">Selected File</span>
            <strong>{file.name}</strong>
          </div>
        )}

        {previewHeaders.length > 0 && data.length === 0 && (
          <section className="data-section">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Source Preview</p>
                <h3>Selected File Preview (First 10 Records)</h3>
              </div>
            </div>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    {previewHeaders.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {previewHeaders.map((header, columnIndex) => (
                        <td key={`${rowIndex}-${header}`}>{row[columnIndex] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {isUploading && (
          <div className="loading-overlay">
            <div className="loading-card">
              <div className="spinner" />
              <p className="loading-title">Analyzing the records...</p>
              <p className="loading-copy">Reviewing valuation patterns, day-over-day moves, and anomaly signals.</p>
            </div>
          </div>
        )}

        {data.length > 0 && (
          <>
            <section className="data-section">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Visual Signal</p>
                  <h3>NAV Trend and Flagged Outliers</h3>
                </div>
              </div>
              <div className="chart-shell">
                <Plot
                  data={[
                    {
                      x: data.map(d=>d.Date),
                      y: data.map(d=>d.NAV),
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: 'NAV',
                      line: { color: '#0f766e', width: 3 },
                      marker: { color: '#134e4a', size: 7 },
                    },
                    {
                      x: data.filter(d=>d.anomaly_flag).map(d=>d.Date),
                      y: data.filter(d=>d.anomaly_flag).map(d=>d.NAV),
                      mode: 'markers',
                      marker: {
                        size: 13,
                        color: '#dc2626',
                        line: { color: '#fff7ed', width: 2 },
                      },
                      name: 'Anomalies'
                    }
                  ]}
                  layout={{
                    autosize: true,
                    height: 420,
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: '#f7fbfa',
                    font: { family: 'Segoe UI, sans-serif', color: '#16302b' },
                    margin: { l: 56, r: 24, t: 30, b: 48 },
                    legend: {
                      orientation: 'h',
                      x: 0,
                      y: 1.14,
                      bgcolor: 'rgba(255,255,255,0.75)',
                    },
                    xaxis: {
                      gridcolor: '#d9ebe8',
                      zerolinecolor: '#d9ebe8',
                      title: 'Date',
                    },
                    yaxis: {
                      gridcolor: '#d9ebe8',
                      zerolinecolor: '#d9ebe8',
                      title: 'NAV',
                    },
                  }}
                  useResizeHandler
                  style={{ width: '100%', height: '100%' }}
                  config={{ displayModeBar: false, responsive: true }}
                />
              </div>
            </section>

            <section className="data-section">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Review Queue</p>
                  <h3>Anomaly Detection Results</h3>
                </div>
                <div className="results-summary">
                  <span>{sortedResults.filter((row) => row.anomaly_flag).length} anomalies</span>
                  <span>{sortedResults.length} total records</span>
                </div>
              </div>
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>NAV</th>
                      <th>Rolling Median NAV</th>
                      <th>MAD</th>
                      <th>Modified Z-Score</th>
                      <th>Day-over-Day %</th>
                      <th>Status</th>
                      <th>Explanation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedResults.map((d,i)=>(
                      <tr key={i} className={d.anomaly_flag ? 'anomaly-row' : 'normal-row'}>
                        <td>{d.Date}</td>
                        <td>{d.NAV}</td>
                        <td>{d.rolling_median_nav}</td>
                        <td>{d.mad}</td>
                        <td>{d.modified_z_score}</td>
                        <td>{d.day_over_day_change_pct}</td>
                        <td>
                          <span className={d.anomaly_flag ? 'status-pill anomaly-pill' : 'status-pill normal-pill'}>
                            {d.anomaly_flag ? 'Anomaly' : 'Normal'}
                          </span>
                        </td>
                        <td className="explanation-cell">{d.explanation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination-bar">
                <button
                  className="secondary-button"
                  onClick={() => setCurrentPage((page) => page - 1)}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span className="page-indicator">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="secondary-button"
                  onClick={() => setCurrentPage((page) => page + 1)}
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            </section>
          </>
        )}

      </div>
    </div>
  )
}

export default App
