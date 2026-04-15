
import { useState } from 'react'
import axios from 'axios'
import Plot from 'react-plotly.js'
import sampleFileUrl from '../sample/samplefile.csv?url'

function App() {
  const previewPageSize = 10
  const resultsPageSize = 10
  const [file, setFile] = useState(null)
  const [data, setData] = useState([])
  const [previewHeaders, setPreviewHeaders] = useState([])
  const [previewRows, setPreviewRows] = useState([])
  const [isUploading, setIsUploading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const parseCsvLine = (line) => line.split(',').map((value) => value.trim())

  const enrichResultsWithStats = (rows) => {
    if (!rows.length) {
      return rows
    }

    const navs = rows.map((row) => Number(row.NAV))
    const mean = navs.reduce((sum, nav) => sum + nav, 0) / navs.length
    const variance = navs.reduce((sum, nav) => sum + Math.pow(nav - mean, 2), 0) / navs.length
    const std = Math.sqrt(variance)

    return rows.map((row) => {
      const nav = Number(row.NAV)
      const zScore = std === 0 ? 0 : (nav - mean) / std

      return {
        ...row,
        mean_nav: row.mean_nav ?? Number(mean.toFixed(2)),
        std_dev: row.std_dev ?? Number(std.toFixed(2)),
        z_score: row.z_score ?? Number(zScore.toFixed(2)),
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
    if (!file) return

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append("file", file)

      //const1 res = await axios.post("http://localhost:5000/upload", formData)
      const res = await axios.post("https://anomaly-backend-xsm7.onrender.com/upload", formData)
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
    <div style={{padding:20, position:'relative'}}>
      <h2>AI Anomaly Detection Dashboard</h2>

      <input type="file" onChange={handleFileChange}/>
      <button onClick={useSampleFile}>Use Sample File</button>
      <button onClick={uploadFile} disabled={!file}>Upload</button>
      {file && <p>Selected file: {file.name}</p>}

      {previewHeaders.length > 0 && data.length === 0 && (
        <>
          <h3>Selected File Preview (First 10 Records)</h3>
          <table border="1" cellPadding="10">
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
        </>
      )}

      {isUploading && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.85)',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                border: '6px solid #d9d9d9',
                borderTop: '6px solid #2563eb',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <p style={{margin: 0, fontSize: 18, fontWeight: 600}}>
              Analyzing the records...
            </p>
          </div>
        </div>
      )}

      {data.length > 0 && (
        <>
          <Plot
            data={[
              {
                x: data.map(d=>d.Date),
                y: data.map(d=>d.NAV),
                type: 'scatter',
                mode: 'lines+markers',
                name: 'NAV'
              },
              {
                x: data.filter(d=>d.anomaly_flag).map(d=>d.Date),
                y: data.filter(d=>d.anomaly_flag).map(d=>d.NAV),
                mode: 'markers',
                marker: {size:12, color:'red'},
                name: 'Anomalies'
              }
            ]}
            layout={{width:800, height:400}}
          />

          <h3>Anomaly Detection Results</h3>
          <table border="1" cellPadding="10">
            <thead>
              <tr>
                <th>Date</th>
                <th>NAV</th>
                <th>Mean NAV</th>
                <th>Std Dev</th>
                <th>Z-Score</th>
                <th>Status</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {paginatedResults.map((d,i)=>(
                <tr key={i} style={{backgroundColor: d.anomaly_flag ? '#ffcccc' : '#ccffcc'}}>
                  <td>{d.Date}</td>
                  <td>{d.NAV}</td>
                  <td>{d.mean_nav}</td>
                  <td>{d.std_dev}</td>
                  <td>{d.z_score}</td>
                  <td>{d.anomaly_flag ? 'Anomaly' : 'Normal'}</td>
                  <td>{d.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{display: 'flex', alignItems: 'center', gap: 12, marginTop: 16}}>
            <button onClick={() => setCurrentPage((page) => page - 1)} disabled={currentPage === 1}>
              Previous
            </button>
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((page) => page + 1)}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        </>
      )}

      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  )
}

export default App
