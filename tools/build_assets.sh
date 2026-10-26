#!/usr/bin/env bash
# Hela modellkedjan: texturer -> Blender (trupper, tärning, maskiner, rekvisita) -> meshopt -> public/models.
# Kör högst en Blender åt gången (16 GB-maskin). Cycles körs på CPU (Metal-GPU:n kraschar, se mats.cycles_gpu).
#   tools/build_assets.sh                    allt (rekvisitan bakas: ~15 min)
#   tools/build_assets.sh --only tank,radio  bara vissa (namn ur units.py / props.py)
#   tools/build_assets.sh --skip-blender     bara komprimering + kontroll av build/models
#   tools/build_assets.sh --fast             halv bakupplösning och färre sampel (utkast)
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
mkdir -p build/models build/previews build/tex public/models public/tex

ARGS=()
SKIP=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-blender) SKIP=1 ;;
    --only) ONLY="$2"; ARGS+=(--only "$2"); shift ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

if [ $SKIP = 0 ]; then
  python3 -I tools/fetch_textures.py >/dev/null
  python3 -I tools/fetch_textures.py --res 1k --only terlenka,rough_linen >/dev/null
  python3 -I tools/make_textures.py
  "$BLENDER" -b -P blender/units.py -- "${ARGS[@]+"${ARGS[@]}"}" 2>&1 | grep -E "Error|Traceback|UNIT|färg" || true
  "$BLENDER" -b -P blender/props.py -- "${ARGS[@]+"${ARGS[@]}"}" 2>&1 | grep -E "Error|Traceback|PROP" || true
fi

UNITS=" infantry tank artillery ship flag dice "
for f in build/models/*.glb; do
  n=$(basename "$f" .glb)
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$n,"* ]]; then continue; fi
  node tools/optimize.mjs "$f" "public/models/$n.glb" 2>/dev/null
  # mobilversion av enheterna: förenklad mesh (texturerna är delade 512)
  if [[ "$UNITS" == *" $n "* ]]; then
    node tools/optimize.mjs "$f" "public/models/${n}_lo.glb" --lod 0.45 2>/dev/null
  fi
  printf "%-10s %6s KB -> %6s KB\n" "$n" $(( $(stat -f%z "$f") / 1024 )) $(( $(stat -f%z "public/models/$n.glb") / 1024 ))
done

# kontaktark av förhandsbilderna
P=build/previews
LIST=""
for n in infantry tank artillery ship flag dice radio tv props; do [ -f $P/$n.png ] && LIST="$LIST $P/$n.png"; done
magick montage $LIST -tile 3x -geometry 600x500+6+6 -background '#15161a' $P/sheet.png 2>/dev/null || true

node tools/inspect_models.mjs public/models
du -sh public/models public/tex
