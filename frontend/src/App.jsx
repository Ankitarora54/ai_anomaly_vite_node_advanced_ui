
import { useState } from 'react'
import axios from 'axios'
import Plot from 'react-plotly.js'

function App() {
  const [file, setFile] = useState(null)
  const [data, setData] = useState([])

  const uploadFile = async () => {
    const formData = new FormData()
    formData.append("file", file)

    //const res = await axios.post("http://localhost:5000/upload", formData)
    const res = await axios.post("https://anomaly-backend-xsm7.onrender.com/upload", formData)
    setData(res.data)
  }

  return (
    <div style={{padding:20}}>
      <h2>AI Anomaly Detection Dashboard</h2>

      <input type="file" onChange={(e)=>setFile(e.target.files[0])}/>
      <button onClick={uploadFile}>Upload</button>

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

          <h3>Data Table</h3>
          <table border="1" cellPadding="10">
            <thead>
              <tr>
                <th>Date</th>
                <th>NAV</th>
                <th>Status</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d,i)=>(
                <tr key={i} style={{backgroundColor: d.anomaly_flag ? '#ffcccc' : '#ccffcc'}}>
                  <td>{d.Date}</td>
                  <td>{d.NAV}</td>
                  <td>{d.anomaly_flag ? 'Anomaly' : 'Normal'}</td>
                  <td>{d.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

export default App
