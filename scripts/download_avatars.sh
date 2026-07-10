#!/bin/bash
# Download avatar PNGs from Figma MCP asset URLs
set -euo pipefail
DIR="/Users/vernonfrancis/Desktop/Portal/public/images/avatars"
BASE="https://www.figma.com/api/mcp/asset"

download() {
  local file="$1"
  local id="$2"
  curl -fsSL "${BASE}/${id}" -o "${DIR}/${file}"
}

download AvatarMale01.png 32057a38-6d99-4241-b017-86f6f33aebac
download AvatarMale02.png c79dd14d-1b85-4037-ad61-865a0598a9cb
download AvatarMale03.png e7eb503f-72d0-4e01-b8ba-ca7ff764d65d
download AvatarMale04.png 90948121-0840-4b37-bbf8-688098827d7b
download AvatarMale05.png 9d5022c4-2ccc-4653-9b8d-81b64d2888a2
download AvatarMale06.png 4ecac006-b4a8-44e0-bb59-62c2e24ef8aa
download AvatarFemale01.png c878b776-327e-4e4d-abea-5085310d33e7
download AvatarFemale02.png de89256a-6748-4ca8-8b94-c51d583f62d8
download AvatarFemale03.png 6b23882e-bb0d-4eaf-8724-d7c0457c5262
download AvatarFemale04.png 3946e865-5ecc-4ecb-a0de-5d3f346c64d9
download AvatarFemale05.png f018ec91-5b55-4c55-a3f5-4674348fc7c9
download AvatarFemale06.png e341bd74-8992-4d4e-bd22-366a2df07743
download Avatar3d01.png 2b8a0844-94da-4f38-870b-54ac81cf5f0b
download Avatar3d02.png 2b754c48-c96e-47cc-a74c-014a781d9af0
download Avatar3d03.png 9715a6e3-4d43-49ab-a4bf-581168e5407e
download Avatar3d04.png 1b5d1af7-8c72-454d-aec6-419a59678faa
download AvatarAbstract01.png 45082bda-6a4e-4da1-8d30-c8bada7a88ca
download AvatarAbstract02.png b17dd048-145b-4820-8b62-8c4cc5b3163c
download AvatarAbstract03.png d7ce0b46-5b00-4dbb-9a16-acd31d42a961
download AvatarAbstract04.png 8b678e9c-ffdc-4781-a721-74740ab66819
download AvatarByewind.png 87eeafa1-cd6f-45a1-9c96-3fe0c812b4b3
download AvatarDefault.png 57f513cb-d911-47fd-8e5e-46aed3e3d536
download AvatarMore.png ec82a2e2-fc90-401e-a441-c34cf52b2e10
download AvatarNophoto.png a85904cc-958f-486b-a550-3ffe99459401

echo "Downloaded $(ls -1 "$DIR"/*.png | wc -l | tr -d ' ') avatars"
