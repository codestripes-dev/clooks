try {
  const value: unknown = await Bun.stdin.json()
  console.log(JSON.stringify({ status: 'fulfilled', value }))
} catch (error) {
  if (!(error instanceof Error)) throw error
  console.log(JSON.stringify({ status: 'rejected', name: error.name, message: error.message }))
}

export {}
