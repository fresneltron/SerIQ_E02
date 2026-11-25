import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ExerciseId } from './vision'

type Props = { exerciseId: ExerciseId; language: 'ru' | 'kz' }

function makeCapsule(radius: number, length: number, material: THREE.Material, geometryList: THREE.BufferGeometry[]) {
  const geometry = new THREE.CapsuleGeometry(radius, length, 6, 12)
  geometryList.push(geometry)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = length / 2
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

export default function InstructionMannequin({ exerciseId, language }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const playingRef = useRef(playing)
  const phaseRef = useRef(0)
  const resumeAnimationRef = useRef<(() => void) | null>(null)
  const title = language === 'ru' ? '3D‑манекен · вид сбоку' : '3D манекен · бүйірінен көрініс'
  const pauseLabel = language === 'ru' ? 'Пауза' : 'Үзіліс'
  const playLabel = language === 'ru' ? 'Воспроизвести движение' : 'Қозғалысты ойнату'

  useEffect(() => {
    const host = containerRef.current
    if (!host) return

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-2.5, 2.5, 1.4, -1.4, 0.1, 30)
    camera.position.set(-0.05, 0.78, 9)
    camera.lookAt(-0.05, 0.78, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    } catch {
      host.dataset.unavailable = 'true'
      host.textContent = language === 'ru' ? '3D‑демонстрация недоступна в этом браузере.' : 'Бұл браузерде 3D көрсетілімі қолжетімсіз.'
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4))
    renderer.setClearColor(0xf0f5f7, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.setAttribute('aria-hidden', 'true')
    host.dataset.unavailable = 'false'
    host.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xf8fcff, 0x788996, 2.1))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6)
    keyLight.position.set(-2.5, 4.5, 6)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xc6e3f1, 0.9)
    fillLight.position.set(3, 0.5, 4)
    scene.add(fillLight)

    const geometryList: THREE.BufferGeometry[] = []
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xdce5ea, roughness: 0.62 })
    const armMaterial = new THREE.MeshStandardMaterial({ color: 0x527991, roughness: 0.5 })
    const jointMaterial = new THREE.MeshStandardMaterial({ color: 0xe4b65e, roughness: 0.42 })
    const palmMaterial = new THREE.MeshStandardMaterial({ color: 0x66889a, roughness: 0.5 })
    const objectMaterial = new THREE.MeshStandardMaterial({ color: 0xd1a04e, roughness: 0.46 })

    const torsoProfile = [
      [0, -0.37], [0.25, -0.37], [0.35, -0.31], [0.39, -0.19],
      [0.37, -0.05], [0.32, 0.12], [0.31, 0.34], [0.34, 0.63],
      [0.43, 0.77], [0.42, 0.86], [0.33, 0.95], [0.23, 0.98], [0, 0.98],
    ].map(([radius, height]) => new THREE.Vector2(radius, height))
    const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 32), bodyMaterial)
    geometryList.push(torso.geometry)
    torso.position.set(-1.55, 0.04, 0)
    scene.add(torso)
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.2, 6, 12), bodyMaterial)
    geometryList.push(neck.geometry)
    neck.position.set(-1.48, 0.88, 0)
    scene.add(neck)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 18), bodyMaterial)
    geometryList.push(head.geometry)
    head.position.set(-1.5, 1.28, 0)
    scene.add(head)
    const shoulder = new THREE.Group()
    shoulder.position.set(-1.18, 0.63, 0.2)
    shoulder.rotation.z = -Math.PI / 2
    scene.add(shoulder)
    const upperLength = 1.08
    shoulder.add(makeCapsule(0.135, upperLength, armMaterial, geometryList))
    const shoulderJoint = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), armMaterial)
    geometryList.push(shoulderJoint.geometry)
    shoulderJoint.position.set(0, 0.02, 0)
    shoulder.add(shoulderJoint)

    const elbow = new THREE.Group()
    elbow.position.y = upperLength
    shoulder.add(elbow)
    const forearmLength = 0.91
    elbow.add(makeCapsule(0.115, forearmLength, armMaterial, geometryList))
    const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), jointMaterial)
    geometryList.push(elbowJoint.geometry)
    elbowJoint.position.set(0, 0.015, 0.015)
    elbow.add(elbowJoint)

    const wrist = new THREE.Group()
    wrist.position.y = forearmLength
    elbow.add(wrist)
    const wristJoint = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 14), palmMaterial)
    geometryList.push(wristJoint.geometry)
    wrist.add(wristJoint)

    const palm = new THREE.Group()
    palm.position.y = 0.04
    wrist.add(palm)
    const palmMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.29, 6, 14), palmMaterial)
    geometryList.push(palmMesh.geometry)
    palmMesh.position.set(0, 0.19, 0)
    palm.add(palmMesh)

    const fingers: THREE.Group[] = []
    for (let index = 0; index < 4; index++) {
      const finger = new THREE.Group()
      finger.position.set((index - 1.5) * 0.073, 0.32, 0)
      palm.add(finger)
      const proximal = makeCapsule(0.036, 0.15, armMaterial, geometryList)
      finger.add(proximal)
      const distalJoint = new THREE.Group()
      distalJoint.position.y = 0.17
      finger.add(distalJoint)
      const joint = new THREE.Mesh(new THREE.SphereGeometry(0.037, 10, 8), armMaterial)
      geometryList.push(joint.geometry)
      joint.position.y = 0.01
      distalJoint.add(joint)
      distalJoint.add(makeCapsule(0.031, 0.13, armMaterial, geometryList))
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), armMaterial)
      geometryList.push(tip.geometry)
      tip.position.y = 0.16
      distalJoint.add(tip)
      fingers.push(finger)
    }
    const thumb = new THREE.Group()
    thumb.position.set(-0.15, 0.17, 0)
    thumb.rotation.z = -0.8
    palm.add(thumb)
    thumb.add(makeCapsule(0.047, 0.18, armMaterial, geometryList))
    const thumbTip = new THREE.Group()
    thumbTip.position.y = 0.2
    thumb.add(thumbTip)
    thumbTip.rotation.z = 0.3
    thumbTip.add(makeCapsule(0.038, 0.15, armMaterial, geometryList))

    if (exerciseId === 'E01') {
      const object = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), objectMaterial)
      geometryList.push(object.geometry)
      object.position.set(0.035, 0.28, 0.08)
      palm.add(object)
    }

    const resize = () => {
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      const viewHeight = 2.3
      const viewWidth = viewHeight * (width / height)
      camera.left = -viewWidth / 2
      camera.right = viewWidth / 2
      camera.top = viewHeight / 2
      camera.bottom = -viewHeight / 2
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    // E02 starts with the forearm raised and bent, then extends it forward.
    const startElbow = exerciseId === 'E02' ? 1.05 : exerciseId === 'E01' ? -0.38 : 0
    const endElbow = exerciseId === 'E02' ? 0 : exerciseId === 'E01' ? 0.72 : 0
    const startWrist = exerciseId === 'E03' ? -0.58 : 0
    const endWrist = exerciseId === 'E03' ? 0.58 : 0
    const startFinger = exerciseId === 'E04' ? -0.82 : -0.08
    const endFinger = exerciseId === 'E04' ? -0.02 : -0.08
    const smoothStep = (value: number) => value * value * (3 - 2 * value)
    const interpolateCycle = (start: number, end: number, phase: number) => {
      if (phase < 0.18 || phase >= 0.84) return start
      if (phase < 0.43) return THREE.MathUtils.lerp(start, end, smoothStep((phase - 0.18) / 0.25))
      if (phase < 0.6) return end
      return THREE.MathUtils.lerp(end, start, smoothStep((phase - 0.6) / 0.24))
    }
    let frame = 0
    const clock = new THREE.Clock()
    phaseRef.current = 0
    const render = () => {
      frame = 0
      const delta = clock.getDelta()
      if (playingRef.current) phaseRef.current = (phaseRef.current + delta / 5.4) % 1
      const phase = phaseRef.current
      elbow.rotation.z = interpolateCycle(startElbow, endElbow, phase)
      wrist.rotation.z = interpolateCycle(startWrist, endWrist, phase)
      const curl = interpolateCycle(startFinger, endFinger, phase)
      fingers.forEach((finger, index) => { finger.rotation.z = curl + (index - 1.5) * 0.035 })
      renderer.render(scene, camera)
      if (playingRef.current) frame = requestAnimationFrame(render)
    }
    resumeAnimationRef.current = () => {
      if (frame) return
      clock.getDelta()
      frame = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(frame)
      resumeAnimationRef.current = null
      observer.disconnect()
      renderer.dispose()
      for (const geometry of geometryList) geometry.dispose()
      bodyMaterial.dispose(); armMaterial.dispose(); jointMaterial.dispose(); palmMaterial.dispose(); objectMaterial.dispose()
      host.replaceChildren()
    }
  }, [exerciseId, language])

  useEffect(() => {
    playingRef.current = playing
    if (playing) resumeAnimationRef.current?.()
  }, [playing])

  return <section className="mannequin-card" aria-label={title}>
    <div className="mannequin-heading"><strong>{title}</strong><button type="button" onClick={() => setPlaying((current) => !current)} aria-label={playing ? pauseLabel : playLabel}>{playing ? 'Ⅱ' : '▶'} <span>{playing ? pauseLabel : playLabel}</span></button></div>
    <div ref={containerRef} className="mannequin-stage" />
    <div className="mannequin-caption">{language === 'ru' ? 'Анимация без речи. Повтор движения плавный, с паузой в крайних положениях.' : 'Дыбыссыз анимация. Қозғалыс шеткі қалыптарда үзіліспен баяу қайталанады.'}</div>
  </section>
}
