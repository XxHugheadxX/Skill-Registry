/* eslint-disable @typescript-eslint/no-explicit-any */
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer
import { useState, useEffect, useRef } from 'react'

import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  type AccountMeta as Web3AccountMeta,
} from '@solana/web3.js'
import { address } from '@solana/kit'
import type { Address, AccountMeta, TransactionSigner } from '@solana/kit'

// IPFS imports
import axios from 'axios'

import { getInitializeProfileInstruction } from '../clients/js/src/generated/instructions/initializeProfile'
import { getReadProfileInstruction } from '../clients/js/src/generated/instructions/readProfile'
import { getUpdateProfileInstruction } from '../clients/js/src/generated/instructions/updateProfile'
import { getAddSkillInstruction } from '../clients/js/src/generated/instructions/addSkill'
import { getCloseProfileInstruction } from '../clients/js/src/generated/instructions/closeProfile'

// ─── Program ID ──────────────────────────────────────────────────────────────
const PROGRAM_ID_STRING = "GggskLBZBfEWv2h27kfGr3vsSniUFyCXCvDzvsMR4T3C"
const PROGRAM_PUBKEY = new PublicKey(PROGRAM_ID_STRING)

// ─── Configuración IPFS (usando Pinata Gateway público) ────────────────────
const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'
// Para pruebas, usamos JSONBlob (gratis, sin API key)
// En producción, usa Pinata con tu API key

// ─── Convertir instruccion Codama a Web3.js ────────────────────────────────
function kitIxToWeb3Ix(ix: {
  programAddress: Address
  accounts: readonly AccountMeta[]
  data: Uint8Array
}): TransactionInstruction {
  const keys: Web3AccountMeta[] = ix.accounts.map((acc) => ({
    pubkey: new PublicKey(acc.address.replace(/[<>]/g, '')),
    isSigner: acc.role === 2 || acc.role === 3,
    isWritable: acc.role === 1 || acc.role === 3,
  }))
  return new TransactionInstruction({
    programId: PROGRAM_PUBKEY,
    keys,
    data: Buffer.from(ix.data),
  })
}

// ─── Derivar PDA ──────────────────────────────────────────────────────────
async function derivarUserProfilePDA(ownerPubkey: PublicKey): Promise<Address> {
  const [pda] = await PublicKey.findProgramAddress(
    [Buffer.from('user-profile'), ownerPubkey.toBuffer()],
    PROGRAM_PUBKEY
  )
  return address(pda.toBase58())
}

// ─── App Principal ────────────────────────────────────────────────────────
export default function App() {
  const { publicKey, connected, sendTransaction } = useWallet()
  const { connection } = useConnection()

  // Estados existentes
  const [name, setName] = useState('')
  const [newName, setNewName] = useState('')
  const [points, setPoints] = useState(100)
  const [txSig, setTxSig] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<any>(null)
  const [profileData, setProfileData] = useState<any>(null)
  
  // Estados para IPFS
  const [proofUrl, setProofUrl] = useState('')
  const [proofDescription, setProofDescription] = useState('')
  const [proofType, setProofType] = useState<'github' | 'certificate' | 'project' | 'other'>('github')
  const [ipfsHash, setIpfsHash] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submittedSkills, setSubmittedSkills] = useState<any[]>([])
  
  // Estados para el efecto de mouse
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Estados del dashboard
  const [dashboardStats, setDashboardStats] = useState({
    totalUsers: 0,
    totalSkills: 0,
    totalPoints: 0,
    successRate: 94
  })

  // Efecto para el mouse move
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      setMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    }
  }

  // Función para subir prueba a IPFS (usando JSONBin.io como alternativa gratuita)
  async function uploadToIPFS() {
    if (!proofUrl && !proofDescription) {
      setError('❌ Completa la URL y descripción de tu prueba')
      return
    }

    setUploading(true)
    setError(null)

    try {
      // Crear objeto con la prueba
      const proofData = {
        wallet: publicKey?.toString(),
        timestamp: new Date().toISOString(),
        type: proofType,
        url: proofUrl,
        description: proofDescription,
        skill: proofType,
        points: points
      }

      // Usar JSONBin.io como servicio temporal (gratis, sin API key)
      // En producción: usar Pinata o Web3.Storage
      const response = await axios.post('https://api.jsonbin.io/v3/b', proofData, {
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': '$2a$10$your_key_here' // Opcional, para pruebas públicas no necesita
        }
      })

      const binId = response.data.metadata?.id
      const mockIpfsHash = `jsonbin_${binId}`
      
      setIpfsHash(mockIpfsHash)
      
      // Guardar en localStorage para demo
      const existing = JSON.parse(localStorage.getItem('skill_proofs') || '[]')
      existing.push({
        ...proofData,
        ipfsHash: mockIpfsHash,
        verified: false,
        id: Date.now()
      })
      localStorage.setItem('skill_proofs', JSON.stringify(existing))
      setSubmittedSkills(existing)
      
      setError(null)
      alert(`✅ Prueba subida exitosamente!\nHash: ${mockIpfsHash}\n\nLa comunidad ahora puede validar tu skill.`)
      
      // Limpiar formulario
      setProofUrl('')
      setProofDescription('')
      
    } catch (err) {
      console.error('Error subiendo a IPFS:', err)
      setError('❌ Error al subir la prueba. Intenta de nuevo.')
    } finally {
      setUploading(false)
    }
  }

  // Cargar skills subidas
  useEffect(() => {
    const saved = localStorage.getItem('skill_proofs')
    if (saved) {
      setSubmittedSkills(JSON.parse(saved))
    }
  }, [])

  // Efecto para cargar estadísticas
  useEffect(() => {
    if (connected) {
      fetchDashboardData()
    }
  }, [connected, connection])

  // Efecto para leer perfil automáticamente al conectar
  useEffect(() => {
    if (connected && publicKey) {
      setTimeout(() => handleReadProfile(), 1000)
    }
  }, [connected, publicKey])

  async function fetchDashboardData() {
    try {
      const proofs = JSON.parse(localStorage.getItem('skill_proofs') || '[]')
      const verifiedProofs = proofs.filter((p: any) => p.verified)
      
      setDashboardStats({
        totalUsers: 47,
        totalSkills: verifiedProofs.length,
        totalPoints: verifiedProofs.reduce((acc: number, p: any) => acc + (p.points || 100), 0),
        successRate: verifiedProofs.length > 0 ? 94 : 0
      })
    } catch (e) {
      console.error('Error fetching stats:', e)
    }
  }

  // ─── Core Functions ───────────────────────────────────────────────────
  async function makeTransaction(web3Ix: TransactionInstruction, actionName: string) {
    if (!publicKey || !connected) throw new Error('Wallet no conectada')
    const { blockhash } = await connection.getLatestBlockhash()
    const tx = new Transaction()
    tx.recentBlockhash = blockhash
    tx.feePayer = publicKey
    tx.add(web3Ix)
    const sig = await sendTransaction(tx, connection)
    setTxSig(sig)
    console.log(`✅ ${actionName}:`, sig)
    return sig
  }

  function getSigner(): TransactionSigner {
    return {
      address: address(publicKey!.toString()),
      signTransactions: async (txs) => txs.map(() => ({})),
    } as unknown as TransactionSigner
  }

  async function handleInitializeProfile() {
    if (!publicKey || !name.trim()) {
      setError('Conecta wallet y escribe un nombre')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const profilePDA = await derivarUserProfilePDA(publicKey)
      const kitIx = getInitializeProfileInstruction({
        profile: profilePDA,
        owner: getSigner(),
        name: name.trim(),
      })
      await makeTransaction(kitIxToWeb3Ix(kitIx as any), 'Inicializar Perfil')
      setName('')
      setTimeout(() => handleReadProfile(), 2000)
    } catch (e) {
      setError(e)
      console.error(e)
    }
    setLoading(false)
  }

  async function handleReadProfile() {
    if (!publicKey) return
    setLoading(true)
    setError(null)
    try {
      const profilePDA = await derivarUserProfilePDA(publicKey)
      const accountInfo = await connection.getAccountInfo(new PublicKey(profilePDA))
      
      if (!accountInfo) {
        setProfileData(null)
        setError('Perfil no encontrado. Créalo primero.')
        setLoading(false)
        return
      }
      
      const data = accountInfo.data
      let offset = 8
      const nameBytes = data.slice(offset, offset + 32)
      const profileName = new TextDecoder().decode(nameBytes).replace(/\0/g, '')
      offset += 32
      const totalPoints = Number(data.readBigUInt64LE(offset))
      offset += 8
      const skillCount = data.readUInt32LE(offset)
      
      setProfileData({ 
        name: profileName, 
        points: totalPoints, 
        skills: skillCount 
      })
      
      const kitIx = getReadProfileInstruction({
        profile: profilePDA,
        owner: getSigner(),
      })
      await makeTransaction(kitIxToWeb3Ix(kitIx as any), 'Leer Perfil')
      
    } catch (e) {
      setError(e)
      console.error(e)
    }
    setLoading(false)
  }

  async function handleUpdateProfile() {
    if (!publicKey || !newName.trim()) {
      setError('Escribe un nuevo nombre')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const profilePDA = await derivarUserProfilePDA(publicKey)
      const kitIx = getUpdateProfileInstruction({
        profile: profilePDA,
        owner: getSigner(),
        newName: newName.trim(),
      })
      await makeTransaction(kitIxToWeb3Ix(kitIx as any), 'Actualizar Perfil')
      setNewName('')
      if (profileData) {
        setProfileData({ ...profileData, name: newName })
      }
      setTimeout(() => handleReadProfile(), 1000)
    } catch (e) {
      setError(e)
      console.error(e)
    }
    setLoading(false)
  }

  async function handleAddSkill() {
    if (!publicKey) {
      setError('Conecta wallet')
      return
    }
    if (points <= 0 || points > 10000) {
      setError('Puntos entre 1 y 10000')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const profilePDA = await derivarUserProfilePDA(publicKey)
      const kitIx = getAddSkillInstruction({
        profile: profilePDA,
        admin: getSigner(),
        points: Number(points),
      })
      await makeTransaction(kitIxToWeb3Ix(kitIx as any), 'Agregar Skill')
      setPoints(100)
      if (profileData) {
        setProfileData({ 
          ...profileData, 
          points: (profileData.points || 0) + points,
          skills: (profileData.skills || 0) + 1
        })
      }
    } catch (e) {
      setError(e)
      console.error(e)
    }
    setLoading(false)
  }

  async function handleCloseProfile() {
    if (!publicKey) return
    if (!window.confirm('⚠️ ¿Seguro? Esta acción es irreversible.')) return
    setLoading(true)
    setError(null)
    try {
      const profilePDA = await derivarUserProfilePDA(publicKey)
      const kitIx = getCloseProfileInstruction({
        profile: profilePDA,
        owner: getSigner(),
      })
      await makeTransaction(kitIxToWeb3Ix(kitIx as any), 'Cerrar Perfil')
      setProfileData(null)
    } catch (e) {
      setError(e)
      console.error(e)
    }
    setLoading(false)
  }

  // ─── UI COMPLETO ──────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      style={{
        minHeight: '100vh',
        background: '#080810',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* EFECTO BRUMA */}
      <div
        style={{
          position: 'absolute',
          left: mousePos.x - 300,
          top: mousePos.y - 300,
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(20,241,149,0.06) 0%, rgba(20,241,149,0.02) 40%, transparent 70%)',
          pointerEvents: 'none',
          transition: 'left 0.1s ease, top 0.1s ease',
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: mousePos.x - 150,
          top: mousePos.y - 150,
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(153,69,255,0.05) 0%, transparent 70%)',
          pointerEvents: 'none',
          transition: 'left 0.08s ease, top 0.08s ease',
          zIndex: 0,
        }}
      />

      {/* CONTENIDO */}
      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* HERO SECTION */}
        <div style={{
          borderBottom: '1px solid rgba(153,69,255,0.25)',
          padding: '2rem 2rem 3rem',
        }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

            {/* NAV */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 900, letterSpacing: '-0.02em', color: '#fff' }}>
                SKILL<span style={{ color: '#14F195' }}>PROOF</span> DAO
              </div>
              <WalletMultiButton style={{
                background: '#14F195',
                color: '#080810',
                fontWeight: 700,
                fontSize: '0.8rem',
                letterSpacing: '0.05em',
                border: 'none',
                borderRadius: '8px',
              }} />
            </div>

            {/* HERO TITLE */}
            <h1 style={{
              fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: '-0.03em',
              color: '#fff',
              margin: '0 0 1rem',
            }}>
              YOUR REPUTATION<br />
              <span style={{ color: '#14F195' }}>LIVES ON-CHAIN.</span>
            </h1>
            <p style={{ color: '#718096', fontSize: '1rem', maxWidth: '480px', lineHeight: 1.6, margin: '0 0 3rem' }}>
              No more fake credentials. Every skill is signed by a mentor and permanently recorded on Solana.
            </p>

            {/* STATS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2rem' }}>
              {[
                { val: dashboardStats.totalUsers.toLocaleString() + '+', label: 'BUILDERS NETWORK' },
                { val: '10+', label: 'ACTIVE MARKETS' },
                { val: dashboardStats.totalSkills.toLocaleString() + '+', label: 'SKILLS VERIFIED' },
                { val: '33', label: 'PROJECTS SHIPPED' },
              ].map((s) => (
                <div key={s.label} style={{ borderTop: '2px solid #14F195', paddingTop: '1rem' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 900, color: '#14F195', letterSpacing: '-0.02em' }}>{s.val}</div>
                  <div style={{ fontSize: '0.65rem', color: '#718096', fontWeight: 600, letterSpacing: '0.1em', marginTop: '0.25rem' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* MAIN */}
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem' }}>

          {/* SECCIÓN DE INSTRUCCIONES - NUEVA */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(20,241,149,0.05) 0%, rgba(153,69,255,0.05) 100%)',
            border: '1px solid rgba(20,241,149,0.3)',
            borderRadius: '16px',
            padding: '2rem',
            marginBottom: '2rem'
          }}>
            <h2 style={{ color: '#14F195', margin: '0 0 1rem 0', fontSize: '1.5rem' }}>
              📋 HOW TO GET VERIFIED
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>1️⃣</div>
                <h3 style={{ color: '#fff', margin: '0 0 0.5rem 0' }}>Create Profile</h3>
                <p style={{ color: '#718096', fontSize: '0.85rem', lineHeight: 1.5 }}>First, initialize your profile with a unique name. This creates your on-chain identity.</p>
              </div>
              <div>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>2️⃣</div>
                <h3 style={{ color: '#fff', margin: '0 0 0.5rem 0' }}>Submit Proof</h3>
                <p style={{ color: '#718096', fontSize: '0.85rem', lineHeight: 1.5 }}>Upload evidence of your skills: GitHub repos, certificates, or project demos.</p>
              </div>
              <div>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>3️⃣</div>
                <h3 style={{ color: '#fff', margin: '0 0 0.5rem 0' }}>Get Validated</h3>
                <p style={{ color: '#718096', fontSize: '0.85rem', lineHeight: 1.5 }}>Community members review your proof. After validation, you earn skill points.</p>
              </div>
              <div>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>4️⃣</div>
                <h3 style={{ color: '#fff', margin: '0 0 0.5rem 0' }}>Build Reputation</h3>
                <p style={{ color: '#718096', fontSize: '0.85rem', lineHeight: 1.5 }}>Accumulate points, unlock roles, and become a trusted validator yourself.</p>
              </div>
            </div>
          </div>

          {/* METRICS */}
          <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9945FF', letterSpacing: '0.15em', marginBottom: '1rem' }}>LIVE METRICS</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
            {[
              { title: 'TOTAL USERS', val: dashboardStats.totalUsers, change: '+12%' },
              { title: 'SKILLS VERIFIED', val: dashboardStats.totalSkills, change: '+23%' },
              { title: 'TOTAL POINTS', val: dashboardStats.totalPoints, change: '+8%' },
              { title: 'SUCCESS RATE', val: `${dashboardStats.successRate}%`, change: '+5%' },
            ].map((m) => (
              <div key={m.title} style={{
                background: '#0d0d1a',
                border: '1px solid rgba(153,69,255,0.2)',
                borderRadius: '12px',
                padding: '1.25rem',
              }}>
                <div style={{ fontSize: '0.65rem', color: '#718096', letterSpacing: '0.1em', marginBottom: '0.4rem' }}>{m.title}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff' }}>{m.val.toLocaleString()}</div>
                <div style={{ fontSize: '0.75rem', color: '#14F195', marginTop: '0.25rem' }}>{m.change}</div>
              </div>
            ))}
          </div>

          {/* WALLET SECTION - CORREGIDA */}
          {connected && (
            <>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9945FF', letterSpacing: '0.15em', marginBottom: '1rem' }}>CONNECTED WALLET</p>
              <div style={{
                background: '#0d0d1a',
                border: '1px solid rgba(20,241,149,0.25)',
                borderRadius: '12px',
                padding: '1.5rem',
                marginBottom: '2rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
              }}>
                <div>
                  <div style={{ fontSize: '0.65rem', color: '#718096', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>WALLET</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#14F195' }}>
                    {publicKey ? (
                      <>
                        {publicKey.toString().slice(0, 16)}...{publicKey.toString().slice(-8)}
                      </>
                    ) : (
                      'Conectando...'
                    )}
                  </div>
                  {profileData && (
                    <>
                      <div style={{ fontSize: '0.65rem', color: '#718096', letterSpacing: '0.1em', marginTop: '0.75rem', marginBottom: '0.25rem' }}>PROFILE</div>
                      <div style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>{profileData.name}</div>
                    </>
                  )}
                </div>
                {profileData && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>
                      {profileData.name}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#718096', marginTop: '0.25rem' }}>
                      {profileData.points || 0} pts &nbsp;|&nbsp; {profileData.skills || 0} skills
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* MENSAJES */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.4)',
              padding: '1rem 1.25rem',
              borderRadius: '8px',
              marginBottom: '1rem',
              color: '#f87171',
              fontSize: '0.85rem',
            }}>
              {typeof error === 'string' ? error : error?.message || JSON.stringify(error)}
            </div>
          )}
          
          {txSig && (
            <div style={{
              background: 'rgba(20,241,149,0.07)',
              border: '1px solid rgba(20,241,149,0.3)',
              padding: '1rem 1.25rem',
              borderRadius: '8px',
              marginBottom: '1rem',
              fontSize: '0.8rem',
            }}>
              <span style={{ color: '#14F195', fontWeight: 700 }}>TX CONFIRMED </span>
              <a
                href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#9945FF', fontFamily: 'monospace', wordBreak: 'break-all', textDecoration: 'none' }}
              >
                {txSig.slice(0, 32)}...
              </a>
            </div>
          )}

          {/* CONNECT CTA */}
          {!connected && (
            <div style={{
              background: '#0d0d1a',
              border: '1px solid rgba(153,69,255,0.3)',
              borderRadius: '12px',
              padding: '4rem 2rem',
              textAlign: 'center',
              marginBottom: '2rem',
            }}>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: '#fff', marginBottom: '0.5rem' }}>
                CONNECT YOUR WALLET
              </div>
              <p style={{ color: '#718096', marginBottom: '2rem' }}>Connect Phantom on Devnet to start your Web3 journey</p>
              <WalletMultiButton style={{
                background: '#14F195',
                color: '#080810',
                fontWeight: 700,
                border: 'none',
                borderRadius: '8px',
              }} />
            </div>
          )}

          {/* ACTIONS GRID */}
          {connected && (
            <>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9945FF', letterSpacing: '0.15em', marginBottom: '1rem' }}>ACTIONS</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>

                {/* CREATE */}
                <div style={{ background: '#0d0d1a', border: '1px solid rgba(20,241,149,0.2)', borderRadius: '12px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
                    <span style={{ background: 'rgba(20,241,149,0.15)', color: '#14F195', fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', letterSpacing: '0.05em' }}>CREATE</span>
                    <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>Create Profile</span>
                  </div>
                  <input
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', marginBottom: '0.75rem', outline: 'none', fontFamily: 'inherit' }}
                  />
                  <button
                    onClick={handleInitializeProfile}
                    disabled={loading || !name.trim()}
                    style={{ width: '100%', padding: '0.7rem', background: loading ? '#1a2a1a' : '#14F195', border: 'none', borderRadius: '8px', color: '#080810', fontWeight: 700, fontSize: '0.8rem', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em' }}
                  >
                    {loading ? 'PROCESSING...' : 'CREATE PROFILE'}
                  </button>
                </div>

                {/* READ */}
                <div style={{ background: '#0d0d1a', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '12px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
                    <span style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', letterSpacing: '0.05em' }}>READ</span>
                    <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>Read Profile</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#718096', marginBottom: '0.75rem', lineHeight: 1.5 }}>Logs your profile state on-chain. Check the explorer to see the full output.</p>
                  <button
                    onClick={handleReadProfile}
                    disabled={loading}
                    style={{ width: '100%', padding: '0.7rem', background: '#3b82f6', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em' }}
                  >
                    {loading ? 'PROCESSING...' : 'READ PROFILE'}
                  </button>
                </div>

                {/* UPDATE */}
                <div style={{ background: '#0d0d1a', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '12px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
                    <span style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', letterSpacing: '0.05em' }}>UPDATE</span>
                    <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>Update Name</span>
                  </div>
                  <input
                    placeholder="New name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', marginBottom: '0.75rem', outline: 'none', fontFamily: 'inherit' }}
                  />
                  <button
                    onClick={handleUpdateProfile}
                    disabled={loading || !newName.trim()}
                    style={{ width: '100%', padding: '0.7rem', background: '#f59e0b', border: 'none', borderRadius: '8px', color: '#080810', fontWeight: 700, fontSize: '0.8rem', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em' }}
                  >
                    {loading ? 'PROCESSING...' : 'UPDATE PROFILE'}
                  </button>
                </div>

                {/* ADD SKILL - Original */}
                <div style={{ background: '#0d0d1a', border: '1px solid rgba(153,69,255,0.2)', borderRadius: '12px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
                    <span style={{ background: 'rgba(153,69,255,0.15)', color: '#c084fc', fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', letterSpacing: '0.05em' }}>ADMIN</span>
                    <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>Add Skill (Admin)</span>
                  </div>
                  <input
                    type="number"
                    placeholder="Points (e.g. 150)"
                    value={points}
                    onChange={(e) => setPoints(Number(e.target.value))}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', marginBottom: '0.75rem', outline: 'none', fontFamily: 'inherit' }}
                  />
                  <button
                    onClick={handleAddSkill}
                    disabled={loading}
                    style={{ width: '100%', padding: '0.7rem', background: '#9945FF', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em' }}
                  >
                    {loading ? 'PROCESSING...' : 'ADD SKILL (ADMIN)'}
                  </button>
                </div>

                {/* NUEVO: SUBIR PRUEBA A IPFS */}
                <div style={{ background: '#0d0d1a', border: '1px solid rgba(20,241,149,0.3)', borderRadius: '12px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
                    <span style={{ background: '#14F195', color: '#080810', fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', letterSpacing: '0.05em' }}>IPFS</span>
                    <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>Submit Skill Proof</span>
                  </div>
                  
                  <select
                    value={proofType}
                    onChange={(e) => setProofType(e.target.value as any)}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', marginBottom: '0.75rem', outline: 'none', fontFamily: 'inherit' }}
                  >
                    <option value="github">GitHub Repository</option>
                    <option value="certificate">Certificate / Badge</option>
                    <option value="project">Project Demo / Portfolio</option>
                    <option value="other">Other (LinkedIn, Blog, etc.)</option>
                  </select>
                  
                  <input
                    type="url"
                    placeholder="URL of your proof (GitHub, LinkedIn, etc.)"
                    value={proofUrl}
                    onChange={(e) => setProofUrl(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', marginBottom: '0.75rem', outline: 'none', fontFamily: 'inherit' }}
                  />
                  
                  <textarea
                    placeholder="Describe your achievement and why this proves your skill..."
                    value={proofDescription}
                    onChange={(e) => setProofDescription(e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', marginBottom: '0.75rem', outline: 'none', fontFamily: 'inherit', resize: 'vertical' }}
                  />
                  
                  <button
                    onClick={uploadToIPFS}
                    disabled={uploading || !proofUrl}
                    style={{ width: '100%', padding: '0.7rem', background: uploading ? '#1a2a1a' : '#14F195', border: 'none', borderRadius: '8px', color: '#080810', fontWeight: 700, fontSize: '0.8rem', cursor: uploading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em' }}
                  >
                    {uploading ? 'UPLOADING TO IPFS...' : '📤 SUBMIT PROOF TO IPFS'}
                  </button>
                  
                  {ipfsHash && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: '#14F195', wordBreak: 'break-all' }}>
                      ✓ Hash: {ipfsHash.slice(0, 20)}...
                    </div>
                  )}
                </div>

                {/* CLOSE */}
                <div style={{ background: '#0d0d1a', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
                    <span style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', letterSpacing: '0.05em' }}>DELETE</span>
                    <span style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 600 }}>Close Profile</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#718096', marginBottom: '0.75rem', lineHeight: 1.5 }}>Permanently closes your account and recovers rent SOL. This action is irreversible.</p>
                  <button
                    onClick={handleCloseProfile}
                    disabled={loading}
                    style={{ width: '100%', padding: '0.7rem', background: '#ef4444', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em' }}
                  >
                    {loading ? 'PROCESSING...' : 'CLOSE PROFILE'}
                  </button>
                </div>

                {/* NETWORK STATUS */}
                <div style={{ background: '#0d0d1a', border: '1px solid rgba(20,241,149,0.2)', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: '#718096', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>NETWORK STATUS</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.25rem' }}>
                      <div style={{ width: '8px', height: '8px', background: '#14F195', borderRadius: '50%' }} />
                      <span style={{ fontSize: '0.85rem', color: '#14F195', fontWeight: 700 }}>DEVNET ACTIVE</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#718096' }}>Solana Devnet — ~400ms finality</div>
                  </div>
                  <div style={{ marginTop: '1rem' }}>
                    <div style={{ fontSize: '0.65rem', color: '#718096', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>WEEKLY ACTIVITY</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '40px' }}>
                      {[30, 50, 40, 80, 60, 100, 45].map((h, i) => (
                        <div key={i} style={{ flex: 1, height: `${h}%`, background: i === 5 ? '#14F195' : 'rgba(153,69,255,0.4)', borderRadius: '2px' }} />
                      ))}
                    </div>
                  </div>
                </div>

              </div>

              {/* SECCIÓN DE SKILLS SUBIDAS */}
              {submittedSkills.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                  <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9945FF', letterSpacing: '0.15em', marginBottom: '1rem' }}>MY SUBMITTED PROOFS</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {submittedSkills.filter((s: any) => s.wallet === publicKey?.toString()).map((skill: any) => (
                      <div key={skill.id} style={{
                        background: '#0d0d1a',
                        border: `1px solid ${skill.verified ? 'rgba(20,241,149,0.5)' : 'rgba(153,69,255,0.3)'}`,
                        borderRadius: '8px',
                        padding: '1rem',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <span style={{ color: '#14F195', fontWeight: 700, fontSize: '0.8rem' }}>{skill.type.toUpperCase()}</span>
                            <div style={{ fontSize: '0.85rem', color: '#fff', marginTop: '0.25rem' }}>{skill.description.slice(0, 60)}...</div>
                            <a href={skill.url} target="_blank" rel="noopener noreferrer" style={{ color: '#9945FF', fontSize: '0.7rem', textDecoration: 'none' }}>
                              🔗 View Proof →
                            </a>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.7rem', color: skill.verified ? '#14F195' : '#f59e0b' }}>
                              {skill.verified ? '✅ VERIFIED' : '⏳ PENDING VALIDATION'}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: '#718096', marginTop: '0.25rem' }}>
                              Hash: {skill.ipfsHash?.slice(0, 16)}...
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}