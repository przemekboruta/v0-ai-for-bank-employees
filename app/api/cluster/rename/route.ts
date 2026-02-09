import { NextResponse } from "next/server"

/**
 * PATCH /api/cluster/rename
 *
 * Zmiana nazwy topiku. Operacja czysto lokalna -- nie wymaga ML pipeline.
 * W produkcji moze logowac zmiane do audit logu.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { topicId, newLabel } = body as {
      topicId: number
      newLabel: string
    }

    if (topicId === undefined || topicId === null) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'topicId' jest wymagane.",
          },
        },
        { status: 400 }
      )
    }

    if (!newLabel || typeof newLabel !== "string" || newLabel.trim().length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'newLabel' jest wymagane i nie moze byc puste.",
          },
        },
        { status: 400 }
      )
    }

    if (newLabel.length > 100) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Nazwa topiku nie moze przekraczac 100 znakow.",
          },
        },
        { status: 400 }
      )
    }

    // PRODUCTION: audit log
    // await auditLog.write({
    //   action: 'topic_rename',
    //   userId: req.user.id,
    //   topicId,
    //   oldLabel: '...',
    //   newLabel: newLabel.trim(),
    //   timestamp: new Date()
    // })

    return NextResponse.json({
      topicId,
      newLabel: newLabel.trim(),
      updated: true,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[rename] Error:", error)
    return NextResponse.json(
      {
        error: {
          code: "PIPELINE_ERROR",
          message: "Nie udalo sie zmienic nazwy topiku.",
        },
      },
      { status: 500 }
    )
  }
}
